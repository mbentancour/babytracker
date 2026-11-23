package handlers

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
	"golang.org/x/oauth2"
)

// OpenID Connect sign-in.
//
// An OIDC sign-in ends exactly where a password sign-in does: a refresh_token
// cookie, from which the SPA obtains its access token through /auth/refresh.
// Everything downstream — RBAC, API tokens, SSE, the HA integration — never
// learns how the session began.
//
// The flow is the authorization code flow with PKCE (S256), state and nonce.
// Those per-attempt secrets travel in a short-lived HMAC-signed cookie rather
// than in server memory, so a restart while someone is at the provider's
// sign-in page doesn't strand them.
//
// Accounts are matched by the provider's (issuer, subject) pair only, never by
// username or email. Those are claims a user may be able to change at the
// provider, and matching on them would let anyone who can rename themselves
// there sign in as the local user of the same name. An existing local account
// is linked from inside that account instead (Settings → Account), which
// proves control of both sides.

const (
	oidcCallbackPath = "/api/auth/oidc/callback"
	oidcFlowCookie   = "oidc_flow"

	// oidcFlowTTL bounds the time between leaving for the provider and coming
	// back — room for a password manager and a second factor, not much more.
	oidcFlowTTL = 10 * time.Minute

	// oidcHTTPTimeout bounds each call to the provider (discovery, token
	// exchange, keys, userinfo) so a hung provider can't pin a request.
	oidcHTTPTimeout = 15 * time.Second
)

// Error codes the callback hands to the SPA in ?oidc_error=. The frontend
// translates them; anything else it shows as a generic failure.
const (
	oidcErrUnavailable   = "unavailable"    // provider unreachable or misconfigured
	oidcErrExpired       = "expired"        // flow cookie missing/expired, or state mismatch
	oidcErrDenied        = "denied"         // the provider returned an error (e.g. the user cancelled)
	oidcErrFailed        = "failed"         // token exchange or ID token verification failed
	oidcErrNotAllowed    = "not_allowed"    // not a member of OIDC_ALLOWED_GROUPS
	oidcErrNoAccount     = "no_account"     // no linked account and auto-provisioning is off
	oidcErrUsernameTaken = "username_taken" // auto-provisioning hit an existing, unlinked username
	oidcErrAlreadyLinked = "already_linked" // linking: the provider account belongs to someone else
)

// oidcAvailable reports whether OIDC sign-in is offered. Never under HA
// ingress: the add-on's iframe neither keeps cookies reliably nor has a stable
// external URL to register as a redirect URI, and HA already authenticates
// everyone who reaches the panel.
func oidcAvailable(cfg *config.Config, inIngress bool) bool {
	return cfg.OIDC.Enabled() && !inIngress
}

type OIDCHandler struct {
	db   *sqlx.DB
	cfg  *config.Config
	auth *AuthHandler

	// flowKey signs the flow cookie. Derived from the JWT secret so there's
	// no second secret to manage, and domain-separated so a flow cookie can
	// never be mistaken for anything the JWT secret signs directly.
	flowKey []byte

	// The provider is discovered on first use rather than at startup, so the
	// app still boots — with password sign-in — while the IdP is down.
	mu       sync.Mutex
	provider *oidc.Provider
}

func NewOIDCHandler(db *sqlx.DB, cfg *config.Config, auth *AuthHandler) *OIDCHandler {
	mac := hmac.New(sha256.New, []byte(cfg.JWTSecret))
	mac.Write([]byte("babytracker oidc flow cookie v1"))

	h := &OIDCHandler{db: db, cfg: cfg, auth: auth, flowKey: mac.Sum(nil)}
	switch {
	case cfg.OIDC.Enabled() && auth.inIngress:
		slog.Warn("OIDC sign-in is not available under Home Assistant ingress; ignoring OIDC_* settings")
	case cfg.OIDC.Enabled():
		slog.Info("OIDC sign-in enabled",
			"issuer", cfg.OIDC.IssuerURL,
			"client_id", cfg.OIDC.ClientID,
			"public_client", cfg.OIDC.ClientSecret == "",
			"redirect_url", cmp.Or(cfg.OIDC.RedirectURL, "(derived per request)"),
			"auto_provision", cfg.OIDC.AutoProvision,
			"password_login", !cfg.OIDC.DisablePasswordLogin)
	}
	return h
}

func (h *OIDCHandler) available() bool {
	return oidcAvailable(h.cfg, h.auth.inIngress)
}

// getProvider discovers the provider once and caches it. A failed discovery
// isn't cached, so the next attempt retries.
func (h *OIDCHandler) getProvider() (*oidc.Provider, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.provider != nil {
		return h.provider, nil
	}
	// Not the request's context: the provider outlives the request, and
	// go-oidc keeps only the HTTP client from it, not its cancellation.
	ctx, cancel := context.WithTimeout(context.Background(), oidcHTTPTimeout)
	defer cancel()
	p, err := oidc.NewProvider(ctx, h.cfg.OIDC.IssuerURL)
	if err != nil {
		return nil, err
	}
	h.provider = p
	return p, nil
}

func (h *OIDCHandler) oauthConfig(p *oidc.Provider, redirectURL string) *oauth2.Config {
	endpoint := p.Endpoint()
	if h.cfg.OIDC.ClientSecret == "" {
		// A public client authenticates with nothing but its client_id in the
		// form body; PKCE is what binds the code to this browser.
		endpoint.AuthStyle = oauth2.AuthStyleInParams
	}
	return &oauth2.Config{
		ClientID:     h.cfg.OIDC.ClientID,
		ClientSecret: h.cfg.OIDC.ClientSecret,
		Endpoint:     endpoint,
		RedirectURL:  redirectURL,
		Scopes:       h.cfg.OIDC.Scopes,
	}
}

// redirectURL is the callback URL registered at the provider. OIDC_REDIRECT_URL
// wins; otherwise it is rebuilt from the request the way the browser sees it
// behind a reverse proxy. Whatever it is, the provider only accepts it if it
// matches a registered redirect URI exactly, so a forged Host header can't
// send a code anywhere else.
func (h *OIDCHandler) redirectURL(r *http.Request) string {
	if h.cfg.OIDC.RedirectURL != "" {
		return h.cfg.OIDC.RedirectURL
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		host = strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	return scheme + "://" + host + oidcCallbackPath
}

// appPath is where the browser lands after the callback: the directory the
// callback lives under, so a deployment behind a path prefix comes back into
// the app rather than to the host root. Always a bare path, never a host —
// nothing in a request can turn it into an open redirect.
func appPath(redirectURL string) string {
	u, err := url.Parse(redirectURL)
	if err != nil {
		return "/"
	}
	prefix, ok := strings.CutSuffix(u.Path, oidcCallbackPath)
	// Browsers read "//host" and "/\host" as another origin.
	if !ok || strings.HasPrefix(prefix, "//") || strings.Contains(prefix, "\\") ||
		(prefix != "" && !strings.HasPrefix(prefix, "/")) {
		return "/"
	}
	return prefix + "/"
}

// --- flow cookie -----------------------------------------------------------

// oidcFlow is what the callback needs to finish what Login or Link started.
type oidcFlow struct {
	State       string `json:"s"`
	Nonce       string `json:"n"`
	Verifier    string `json:"v"`
	RedirectURL string `json:"r"`
	// LinkUserID is set when a signed-in user is linking their account; the
	// callback then links instead of signing in.
	LinkUserID int   `json:"l,omitempty"`
	Expires    int64 `json:"e"`
}

func (h *OIDCHandler) sign(payload string) string {
	mac := hmac.New(sha256.New, h.flowKey)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (h *OIDCHandler) sealFlow(f oidcFlow) string {
	b, _ := json.Marshal(f)
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + h.sign(payload)
}

func (h *OIDCHandler) openFlow(value string) (*oidcFlow, bool) {
	payload, sig, ok := strings.Cut(value, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(h.sign(payload))) {
		return nil, false
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	var f oidcFlow
	if err := json.Unmarshal(b, &f); err != nil || time.Now().Unix() > f.Expires {
		return nil, false
	}
	return &f, true
}

// flowCookie mirrors the refresh cookie's flags. SameSite=Lax rather than
// Strict because the callback is a cross-site navigation from the provider —
// Lax still sends the cookie on that top-level GET, and nowhere else.
func (h *OIDCHandler) flowCookie(r *http.Request, value string, maxAge int) *http.Cookie {
	c := h.auth.refreshCookie(r, value, maxAge)
	c.Name = oidcFlowCookie
	return c
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// begin sets the flow cookie and returns the provider URL to send the browser to.
func (h *OIDCHandler) begin(w http.ResponseWriter, r *http.Request, linkUserID int) (string, error) {
	p, err := h.getProvider()
	if err != nil {
		return "", fmt.Errorf("discovery: %w", err)
	}
	state, err := randomToken()
	if err != nil {
		return "", err
	}
	nonce, err := randomToken()
	if err != nil {
		return "", err
	}
	flow := oidcFlow{
		State:       state,
		Nonce:       nonce,
		Verifier:    oauth2.GenerateVerifier(),
		RedirectURL: h.redirectURL(r),
		LinkUserID:  linkUserID,
		Expires:     time.Now().Add(oidcFlowTTL).Unix(),
	}
	http.SetCookie(w, h.flowCookie(r, h.sealFlow(flow), int(oidcFlowTTL.Seconds())))

	return h.oauthConfig(p, flow.RedirectURL).AuthCodeURL(state,
		oidc.Nonce(nonce),
		oauth2.S256ChallengeOption(flow.Verifier),
	), nil
}

// --- handlers --------------------------------------------------------------

// Login sends the browser to the provider. A GET, because the sign-in button
// is a plain link: a fetch can't follow a redirect to another origin.
func (h *OIDCHandler) Login(w http.ResponseWriter, r *http.Request) {
	if !h.available() {
		http.NotFound(w, r)
		return
	}
	authURL, err := h.begin(w, r, 0)
	if err != nil {
		slog.Error("oidc: cannot start sign-in", "error", err)
		h.fail(w, r, h.redirectURL(r), oidcErrUnavailable)
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

// Link starts linking the signed-in account to an account at the provider and
// returns the provider URL for the SPA to navigate to.
func (h *OIDCHandler) Link(w http.ResponseWriter, r *http.Request) {
	if !h.available() {
		pagination.WriteError(w, http.StatusNotFound, "OIDC sign-in is not enabled")
		return
	}
	// Only an interactive session may link. An API token is a narrower,
	// revocable credential handed to integrations; letting it attach a
	// provider account would turn it into a full sign-in for its holder.
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		pagination.WriteError(w, http.StatusForbidden, "linking requires a signed-in session")
		return
	}
	authURL, err := h.begin(w, r, middleware.GetUserID(r.Context()))
	if err != nil {
		slog.Error("oidc: cannot start account linking", "error", err)
		pagination.WriteError(w, http.StatusBadGateway, "identity provider unavailable")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]string{"url": authURL})
}

// Callback is where the provider sends the browser back to.
func (h *OIDCHandler) Callback(w http.ResponseWriter, r *http.Request) {
	if !h.available() {
		http.NotFound(w, r)
		return
	}

	var flow *oidcFlow
	if c, err := r.Cookie(oidcFlowCookie); err == nil {
		flow, _ = h.openFlow(c.Value)
	}
	// Single use, whatever happens next.
	http.SetCookie(w, h.flowCookie(r, "", -1))

	q := r.URL.Query()
	if flow == nil || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(flow.State)) != 1 {
		h.fail(w, r, h.redirectURL(r), oidcErrExpired)
		return
	}
	if e := q.Get("error"); e != "" {
		slog.Info("oidc: provider returned an error", "error", e, "description", q.Get("error_description"))
		h.fail(w, r, flow.RedirectURL, oidcErrDenied)
		return
	}

	id, err := h.exchange(r.Context(), flow, q.Get("code"))
	if err != nil {
		slog.Warn("oidc: sign-in failed", "error", err)
		h.fail(w, r, flow.RedirectURL, oidcErrFailed)
		return
	}

	if flow.LinkUserID != 0 {
		h.finishLink(w, r, flow, id)
		return
	}

	user, code := h.resolveUser(id)
	if code != "" {
		h.fail(w, r, flow.RedirectURL, code)
		return
	}
	if _, err := h.auth.startSession(w, r, user); err != nil {
		slog.Error("oidc: cannot start session", "error", err)
		h.fail(w, r, flow.RedirectURL, oidcErrFailed)
		return
	}
	http.Redirect(w, r, appPath(flow.RedirectURL), http.StatusFound)
}

func (h *OIDCHandler) fail(w http.ResponseWriter, r *http.Request, redirectURL, code string) {
	http.Redirect(w, r, appPath(redirectURL)+"?oidc_error="+code, http.StatusFound)
}

// --- identity --------------------------------------------------------------

// oidcIdentity is what BabyTracker takes from the provider.
type oidcIdentity struct {
	Issuer   string
	Subject  string
	Username string
	Groups   []string
	// HasGroups distinguishes "member of nothing" from "the provider didn't
	// say" — the latter must not demote anyone.
	HasGroups bool
}

func (id *oidcIdentity) inGroup(group string) bool {
	return slices.Contains(id.Groups, group)
}

type oidcClaims struct {
	Subject           string          `json:"sub"`
	PreferredUsername string          `json:"preferred_username"`
	Email             string          `json:"email"`
	Groups            json.RawMessage `json:"groups"`
}

// groups accepts the claim as an array of strings or as a single string;
// providers differ. Kanidm sends an array of SPNs ("family@idm.example.com")
// and UUIDs.
func (c *oidcClaims) groups() ([]string, bool) {
	if len(c.Groups) == 0 || string(c.Groups) == "null" {
		return nil, false
	}
	var list []string
	if err := json.Unmarshal(c.Groups, &list); err == nil {
		return list, true
	}
	var one string
	if err := json.Unmarshal(c.Groups, &one); err == nil {
		return []string{one}, true
	}
	return nil, false
}

// exchange redeems the code, verifies the ID token and extracts the identity.
func (h *OIDCHandler) exchange(ctx context.Context, flow *oidcFlow, code string) (*oidcIdentity, error) {
	if code == "" {
		return nil, errors.New("callback without a code")
	}
	p, err := h.getProvider()
	if err != nil {
		return nil, fmt.Errorf("discovery: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, oidcHTTPTimeout)
	defer cancel()

	tok, err := h.oauthConfig(p, flow.RedirectURL).Exchange(ctx, code, oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	rawID, _ := tok.Extra("id_token").(string)
	if rawID == "" {
		return nil, errors.New("token response has no id_token")
	}
	// Checks signature (against the provider's JWKS, any algorithm it
	// advertises — Kanidm signs ES256), issuer, audience and expiry.
	idt, err := p.Verifier(&oidc.Config{ClientID: h.cfg.OIDC.ClientID}).Verify(ctx, rawID)
	if err != nil {
		return nil, fmt.Errorf("id token: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(idt.Nonce), []byte(flow.Nonce)) != 1 {
		return nil, errors.New("id token nonce mismatch")
	}

	var claims oidcClaims
	if err := idt.Claims(&claims); err != nil {
		return nil, fmt.Errorf("id token claims: %w", err)
	}
	id := &oidcIdentity{Issuer: idt.Issuer, Subject: idt.Subject}
	id.Groups, id.HasGroups = claims.groups()

	// Some providers only put groups in the userinfo response.
	needGroups := h.cfg.OIDC.AdminGroup != "" || len(h.cfg.OIDC.AllowedGroups) > 0
	if !id.HasGroups && needGroups && p.UserInfoEndpoint() != "" {
		info, err := p.UserInfo(ctx, oauth2.StaticTokenSource(tok))
		if err != nil {
			slog.Warn("oidc: userinfo request failed", "error", err)
		} else if info.Subject == idt.Subject {
			var uc oidcClaims
			if err := info.Claims(&uc); err == nil {
				id.Groups, id.HasGroups = uc.groups()
				if claims.PreferredUsername == "" {
					claims.PreferredUsername = uc.PreferredUsername
				}
				if claims.Email == "" {
					claims.Email = uc.Email
				}
			}
		}
	}

	id.Username = usernameFromClaims(&claims, idt.Subject)
	return id, nil
}

// usernameFromClaims picks the local username for a new account. Only a
// label: it is never used to find an existing account.
func usernameFromClaims(c *oidcClaims, subject string) string {
	for _, v := range []string{c.PreferredUsername, c.Email, subject} {
		if v = strings.TrimSpace(v); len(v) >= 3 {
			return v
		}
	}
	return "user-" + subject
}

// resolveUser finds or creates the local account for a provider identity.
// Returns an oidcErr* code when the identity may not sign in.
func (h *OIDCHandler) resolveUser(id *oidcIdentity) (*models.User, string) {
	oc := h.cfg.OIDC
	if len(oc.AllowedGroups) > 0 && !slices.ContainsFunc(oc.AllowedGroups, id.inGroup) {
		slog.Info("oidc: sign-in refused, not in OIDC_ALLOWED_GROUPS", "subject", id.Subject)
		return nil, oidcErrNotAllowed
	}

	user, err := models.GetUserByIdentity(h.db, id.Issuer, id.Subject)
	if err == nil {
		_ = models.TouchIdentity(h.db, id.Issuer, id.Subject)
		h.syncAdmin(user, id)
		return user, ""
	}
	if !errors.Is(err, sql.ErrNoRows) {
		slog.Error("oidc: identity lookup failed", "error", err)
		return nil, oidcErrFailed
	}

	// A fresh install's first account may come from the provider, as it
	// would from /auth/register — and like it, it is always an admin.
	count, err := models.CountUsers(h.db)
	if err != nil {
		slog.Error("oidc: count users", "error", err)
		return nil, oidcErrFailed
	}
	firstUser := count == 0
	if !firstUser && !oc.AutoProvision {
		slog.Info("oidc: sign-in refused, no linked account and OIDC_AUTO_PROVISION is off",
			"subject", id.Subject, "username", id.Username)
		return nil, oidcErrNoAccount
	}

	// Never adopt an existing account by name — see the note at the top.
	if _, err := models.GetUserByUsername(h.db, id.Username); err == nil {
		slog.Info("oidc: sign-in refused, username belongs to an unlinked local account",
			"subject", id.Subject, "username", id.Username)
		return nil, oidcErrUsernameTaken
	}

	hash, err := unusablePasswordHash()
	if err != nil {
		return nil, oidcErrFailed
	}
	isAdmin := firstUser || (oc.AdminGroup != "" && id.inGroup(oc.AdminGroup))
	user, err = models.CreateUserWithIdentity(h.db, id.Username, hash, isAdmin, id.Issuer, id.Subject)
	if err != nil {
		slog.Error("oidc: cannot create account", "username", id.Username, "error", err)
		return nil, oidcErrFailed
	}
	slog.Info("oidc: created account", "user_id", user.ID, "username", user.Username, "admin", isAdmin)
	return user, ""
}

// syncAdmin makes OIDC_ADMIN_GROUP authoritative for the admin flag of
// accounts that sign in through the provider. Skipped when the provider sent
// no groups at all, so a missing scope can't silently demote every admin.
func (h *OIDCHandler) syncAdmin(user *models.User, id *oidcIdentity) {
	group := h.cfg.OIDC.AdminGroup
	if group == "" {
		return
	}
	if !id.HasGroups {
		slog.Warn("oidc: OIDC_ADMIN_GROUP is set but the provider sent no groups claim; admin flag left unchanged",
			"user_id", user.ID)
		return
	}
	want := id.inGroup(group)
	if want == user.IsAdmin {
		return
	}
	applied, err := models.SetAdminFromProvider(h.db, user.ID, want)
	switch {
	case err != nil:
		slog.Error("oidc: cannot update admin flag", "user_id", user.ID, "error", err)
	case !applied:
		slog.Warn("oidc: not demoting the last admin", "user_id", user.ID, "username", user.Username)
	default:
		slog.Info("oidc: admin flag updated from OIDC_ADMIN_GROUP", "user_id", user.ID, "admin", want)
		user.IsAdmin = want
	}
}

func (h *OIDCHandler) finishLink(w http.ResponseWriter, r *http.Request, flow *oidcFlow, id *oidcIdentity) {
	oc := h.cfg.OIDC
	if len(oc.AllowedGroups) > 0 && !slices.ContainsFunc(oc.AllowedGroups, id.inGroup) {
		h.fail(w, r, flow.RedirectURL, oidcErrNotAllowed)
		return
	}
	// The account may have been deleted while its owner was at the provider.
	if _, err := models.GetUserByID(h.db, flow.LinkUserID); err != nil {
		h.fail(w, r, flow.RedirectURL, oidcErrFailed)
		return
	}
	err := models.LinkIdentity(h.db, flow.LinkUserID, id.Issuer, id.Subject)
	switch {
	case errors.Is(err, models.ErrIdentityTaken):
		h.fail(w, r, flow.RedirectURL, oidcErrAlreadyLinked)
		return
	case err != nil:
		slog.Error("oidc: cannot link account", "user_id", flow.LinkUserID, "error", err)
		h.fail(w, r, flow.RedirectURL, oidcErrFailed)
		return
	}
	slog.Info("oidc: linked account", "user_id", flow.LinkUserID, "subject", id.Subject)
	http.Redirect(w, r, appPath(flow.RedirectURL)+"?oidc_linked=1", http.StatusFound)
}

// unusablePasswordHash gives an account created through the provider a
// password nobody knows. Every password code path expects a real hash, and a
// random one makes a password attempt on this account behave exactly like a
// wrong password — timing included — until an admin chooses to set one.
func unusablePasswordHash() (string, error) {
	pw, err := randomToken()
	if err != nil {
		return "", err
	}
	return crypto.HashPassword(pw)
}
