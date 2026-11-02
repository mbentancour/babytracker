package handlers

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc/oidctest"
	jose "github.com/go-jose/go-jose/v4"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
)

// These drive the whole OIDC flow against a fake provider shaped like Kanidm:
// a per-client issuer path, ES256-signed ID tokens, PKCE S256 enforced at the
// token endpoint, and groups as an array of SPNs. The tests play the browser —
// follow the redirect to the provider, "sign in", and bring the code back with
// the flow cookie.

const testClientID = "babytracker"

type fakeIdP struct {
	t      *testing.T
	srv    *httptest.Server
	issuer string
	key    *ecdsa.PrivateKey
	secret string // empty: public client, which must authenticate with client_id only

	mu    sync.Mutex
	codes map[string]pendingCode

	// The account that "signs in" next.
	sub               string
	preferredUsername string
	groups            []string          // nil: no groups claim in the ID token
	userinfoGroups    []string          // nil: none in userinfo either
	nonceOverride     string            // non-empty: sign this nonce instead of the requested one
	signer            *ecdsa.PrivateKey // non-nil: sign with this instead of the published key
}

type pendingCode struct {
	challenge, nonce, redirectURI string
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	idp := &fakeIdP{t: t, key: key, codes: map[string]pendingCode{}, sub: "11111111-2222-3333-4444-555555555555",
		preferredUsername: "alice"}

	mux := http.NewServeMux()
	idp.srv = httptest.NewServer(mux)
	t.Cleanup(idp.srv.Close)
	idp.issuer = idp.srv.URL + "/oauth2/openid/" + testClientID

	mux.HandleFunc("/oauth2/openid/"+testClientID+"/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                idp.issuer,
			"authorization_endpoint":                idp.srv.URL + "/ui/oauth2",
			"token_endpoint":                        idp.srv.URL + "/oauth2/token",
			"userinfo_endpoint":                     idp.issuer + "/userinfo",
			"jwks_uri":                              idp.issuer + "/public_key.jwk",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"ES256"},
			"code_challenge_methods_supported":      []string{"S256"},
		})
	})
	mux.HandleFunc("/oauth2/openid/"+testClientID+"/public_key.jwk", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &idp.key.PublicKey, KeyID: "k1", Algorithm: "ES256", Use: "sig"},
		}})
	})
	mux.HandleFunc("/oauth2/token", idp.token)
	mux.HandleFunc("/oauth2/openid/"+testClientID+"/userinfo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer at-"+idp.sub {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		claims := map[string]any{"sub": idp.sub}
		if idp.userinfoGroups != nil {
			claims["groups"] = idp.userinfoGroups
		}
		json.NewEncoder(w).Encode(claims)
	})
	return idp
}

// authorize plays the provider's sign-in page: validates the authorization
// request and returns the callback URL the browser would be sent to.
func (idp *fakeIdP) authorize(authURL string) string {
	idp.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		idp.t.Fatal(err)
	}
	q := u.Query()
	for k, want := range map[string]string{
		"response_type":         "code",
		"client_id":             testClientID,
		"code_challenge_method": "S256",
	} {
		if got := q.Get(k); got != want {
			idp.t.Fatalf("authorization request %s = %q, want %q", k, got, want)
		}
	}
	for _, k := range []string{"code_challenge", "state", "nonce", "redirect_uri"} {
		if q.Get(k) == "" {
			idp.t.Fatalf("authorization request has no %s", k)
		}
	}
	if !strings.Contains(" "+q.Get("scope")+" ", " openid ") {
		idp.t.Fatalf("scope %q lacks openid", q.Get("scope"))
	}

	code := base64.RawURLEncoding.EncodeToString([]byte(idp.sub + time.Now().String()))
	idp.mu.Lock()
	idp.codes[code] = pendingCode{challenge: q.Get("code_challenge"), nonce: q.Get("nonce"), redirectURI: q.Get("redirect_uri")}
	idp.mu.Unlock()

	cb, _ := url.Parse(q.Get("redirect_uri"))
	cq := cb.Query()
	cq.Set("code", code)
	cq.Set("state", q.Get("state"))
	cb.RawQuery = cq.Encode()
	return cb.String()
}

func (idp *fakeIdP) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Client authentication.
	user, pass, basic := r.BasicAuth()
	switch {
	case idp.secret == "" && (basic || r.PostForm.Get("client_secret") != "" || r.PostForm.Get("client_id") != testClientID):
		tokenError(w, "invalid_client")
		return
	case idp.secret != "" && !(basic && user == testClientID && pass == idp.secret):
		tokenError(w, "invalid_client")
		return
	}

	idp.mu.Lock()
	pc, ok := idp.codes[r.PostForm.Get("code")]
	delete(idp.codes, r.PostForm.Get("code"))
	idp.mu.Unlock()
	if !ok || r.PostForm.Get("grant_type") != "authorization_code" || r.PostForm.Get("redirect_uri") != pc.redirectURI {
		tokenError(w, "invalid_grant")
		return
	}
	// PKCE S256, as Kanidm requires.
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != pc.challenge {
		tokenError(w, "invalid_grant")
		return
	}

	nonce := pc.nonce
	if idp.nonceOverride != "" {
		nonce = idp.nonceOverride
	}
	claims := map[string]any{
		"iss":                idp.issuer,
		"sub":                idp.sub,
		"aud":                testClientID,
		"iat":                time.Now().Unix(),
		"exp":                time.Now().Add(5 * time.Minute).Unix(),
		"nonce":              nonce,
		"preferred_username": idp.preferredUsername,
		"email":              idp.preferredUsername + "@example.com",
	}
	if idp.groups != nil {
		claims["groups"] = idp.groups
	}
	cj, _ := json.Marshal(claims)
	signer := idp.key
	if idp.signer != nil {
		signer = idp.signer
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": "at-" + idp.sub,
		"token_type":   "Bearer",
		"expires_in":   300,
		"id_token":     oidctest.SignIDToken(signer, "k1", "ES256", string(cj)),
	})
}

func tokenError(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func oidcHandler(t *testing.T, db *sqlx.DB, idp *fakeIdP, mutate func(*config.OIDCConfig)) *OIDCHandler {
	t.Helper()
	cfg := &config.Config{
		JWTSecret: "test-secret-for-oidc-tests",
		OIDC: config.OIDCConfig{
			IssuerURL:    idp.issuer,
			ClientID:     testClientID,
			ClientSecret: idp.secret,
			Scopes:       []string{"openid", "profile", "email", "groups"},
			ProviderName: "Kanidm",
		},
	}
	if mutate != nil {
		mutate(&cfg.OIDC)
	}
	auth := NewAuthHandler(db, cfg)
	auth.inIngress = false
	return NewOIDCHandler(db, cfg, auth)
}

func cookieNamed(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// startLogin hits /api/auth/oidc/login and returns the provider URL and the
// flow cookie.
func startLogin(t *testing.T, h *OIDCHandler) (string, *http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://bt.example/api/auth/oidc/login", nil)
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("login: got %d, want 302 (body: %s)", rec.Code, rec.Body.String())
	}
	flow := cookieNamed(rec, oidcFlowCookie)
	if flow == nil {
		t.Fatal("login set no flow cookie")
	}
	return rec.Header().Get("Location"), flow
}

func callback(h *OIDCHandler, callbackURL string, flow *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, callbackURL, nil)
	if flow != nil {
		req.AddCookie(flow)
	}
	rec := httptest.NewRecorder()
	h.Callback(rec, req)
	return rec
}

// signIn runs the whole browser round trip and returns the callback response.
func signIn(t *testing.T, h *OIDCHandler, idp *fakeIdP) *httptest.ResponseRecorder {
	t.Helper()
	authURL, flow := startLogin(t, h)
	return callback(h, idp.authorize(authURL), flow)
}

func wantRedirect(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	if rec.Code != http.StatusFound {
		t.Fatalf("got %d, want 302 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Location"); got != want {
		t.Fatalf("redirected to %q, want %q", got, want)
	}
}

func countRows(t *testing.T, db *sqlx.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.Get(&n, query, args...); err != nil {
		t.Fatal(err)
	}
	return n
}

// --- no database needed ------------------------------------------------------

func TestOIDCLoginRequestUsesPKCEAndProtectedCookie(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	authURL, flow := startLogin(t, h)

	u, _ := url.Parse(authURL)
	if got := u.Query().Get("redirect_uri"); got != "http://bt.example/api/auth/oidc/callback" {
		t.Errorf("redirect_uri = %q", got)
	}
	idp.authorize(authURL) // validates S256, state, nonce, scope

	if !flow.HttpOnly || flow.SameSite != http.SameSiteLaxMode || flow.Path != "/" {
		t.Errorf("flow cookie flags: HttpOnly=%v SameSite=%v Path=%q", flow.HttpOnly, flow.SameSite, flow.Path)
	}
	if flow.Secure {
		t.Error("flow cookie Secure over plain HTTP; the browser would drop it")
	}
	// The verifier must not leak into the authorization request.
	f, ok := h.openFlow(flow.Value)
	if !ok {
		t.Fatal("flow cookie doesn't open")
	}
	if strings.Contains(authURL, f.Verifier) {
		t.Error("authorization URL contains the PKCE verifier")
	}
}

func TestOIDCLoginBehindTLSProxy(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	req := httptest.NewRequest(http.MethodGet, "http://babytracker:8099/api/auth/oidc/login", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "baby.example.com")
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	u, _ := url.Parse(rec.Header().Get("Location"))
	if got := u.Query().Get("redirect_uri"); got != "https://baby.example.com/api/auth/oidc/callback" {
		t.Errorf("redirect_uri = %q", got)
	}
	if c := cookieNamed(rec, oidcFlowCookie); c == nil || !c.Secure {
		t.Error("flow cookie should be Secure behind an HTTPS proxy")
	}
}

func TestOIDCConfiguredRedirectURLWins(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, func(c *config.OIDCConfig) {
		c.RedirectURL = "https://baby.example.com/tracker/api/auth/oidc/callback"
	})
	authURL, _ := startLogin(t, h)
	u, _ := url.Parse(authURL)
	if got := u.Query().Get("redirect_uri"); got != h.cfg.OIDC.RedirectURL {
		t.Errorf("redirect_uri = %q", got)
	}
}

func TestOIDCCallbackRejectsMissingOrForeignFlow(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	authURL, flow := startLogin(t, h)
	cbURL := idp.authorize(authURL)

	// No cookie: someone else's code delivered to this browser (login CSRF).
	wantRedirect(t, callback(h, cbURL, nil), "/?oidc_error=expired")

	// The cookie of a different attempt: state doesn't match.
	_, other := startLogin(t, h)
	wantRedirect(t, callback(h, cbURL, other), "/?oidc_error=expired")

	// A forged cookie.
	forged := *flow
	forged.Value = strings.Replace(flow.Value, ".", "x.", 1)
	wantRedirect(t, callback(h, cbURL, &forged), "/?oidc_error=expired")
}

func TestOIDCCallbackRejectsNonceMismatch(t *testing.T) {
	idp := newFakeIdP(t)
	idp.nonceOverride = "replayed-nonce"
	h := oidcHandler(t, nil, idp, nil)
	wantRedirect(t, signIn(t, h, idp), "/?oidc_error=failed")
}

func TestOIDCCallbackRejectsWrongSigningKey(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	authURL, flow := startLogin(t, h)
	cbURL := idp.authorize(authURL)
	// Sign with a key the provider doesn't publish.
	idp.signer, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	wantRedirect(t, callback(h, cbURL, flow), "/?oidc_error=failed")
}

func TestOIDCCallbackProviderError(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	authURL, flow := startLogin(t, h)
	u, _ := url.Parse(authURL)
	cb := "http://bt.example/api/auth/oidc/callback?error=access_denied&state=" + url.QueryEscape(u.Query().Get("state"))
	wantRedirect(t, callback(h, cb, flow), "/?oidc_error=denied")
}

func TestOIDCUnreachableProvider(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	idp.srv.Close()
	req := httptest.NewRequest(http.MethodGet, "http://bt.example/api/auth/oidc/login", nil)
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	wantRedirect(t, rec, "/?oidc_error=unavailable")
}

func TestOIDCDisabledUnderIngress(t *testing.T) {
	idp := newFakeIdP(t)
	h := oidcHandler(t, nil, idp, nil)
	h.auth.inIngress = true
	req := httptest.NewRequest(http.MethodGet, "http://bt.example/api/auth/oidc/login", nil)
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", rec.Code)
	}
}

func TestOIDCFlowCookieExpires(t *testing.T) {
	h := &OIDCHandler{flowKey: []byte("k")}
	v := h.sealFlow(oidcFlow{State: "s", Expires: time.Now().Add(-time.Second).Unix()})
	if _, ok := h.openFlow(v); ok {
		t.Error("expired flow accepted")
	}
	v = h.sealFlow(oidcFlow{State: "s", Expires: time.Now().Add(time.Minute).Unix()})
	if _, ok := h.openFlow(v); !ok {
		t.Error("fresh flow rejected")
	}
	if _, ok := (&OIDCHandler{flowKey: []byte("other")}).openFlow(v); ok {
		t.Error("flow signed with another key accepted")
	}
}

func TestAppPath(t *testing.T) {
	for in, want := range map[string]string{
		"https://baby.example.com/api/auth/oidc/callback":           "/",
		"https://baby.example.com/tracker/api/auth/oidc/callback":   "/tracker/",
		"https://baby.example.com//evil.com/api/auth/oidc/callback": "/",
		`https://baby.example.com/\evil.com/api/auth/oidc/callback`: "/",
		"https://baby.example.com/somewhere/else":                   "/",
		"::not a url": "/",
	} {
		if got := appPath(in); got != want {
			t.Errorf("appPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOIDCGroupsClaimShapes(t *testing.T) {
	for raw, want := range map[string][]string{
		`{"groups":["family@idm.example.com","00000000-0000-0000-0000-000000000001"]}`: {"family@idm.example.com", "00000000-0000-0000-0000-000000000001"},
		`{"groups":"family"}`: {"family"},
		`{"groups":[]}`:       {},
	} {
		var c oidcClaims
		json.Unmarshal([]byte(raw), &c)
		got, ok := c.groups()
		if !ok || strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s: got %v, %v", raw, got, ok)
		}
	}
	var c oidcClaims
	json.Unmarshal([]byte(`{}`), &c)
	if _, ok := c.groups(); ok {
		t.Error("absent groups claim reported as present")
	}
}

// --- against Postgres --------------------------------------------------------

func TestOIDCFirstSignInCreatesAdminAndSession(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	h := oidcHandler(t, db, idp, nil) // auto-provisioning off: the first account is still allowed

	rec := signIn(t, h, idp)
	wantRedirect(t, rec, "/")

	var admin bool
	if err := db.Get(&admin, `SELECT is_admin FROM users WHERE username = 'alice'`); err != nil {
		t.Fatalf("account not created: %v", err)
	}
	if !admin {
		t.Error("first account isn't an admin")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM user_identities WHERE issuer = $1 AND subject = $2`, idp.issuer, idp.sub); n != 1 {
		t.Errorf("identity rows = %d, want 1", n)
	}

	// The cookie is an ordinary session: /auth/refresh turns it into an access token.
	rt := cookieNamed(rec, "refresh_token")
	if rt == nil || rt.Value == "" || !rt.HttpOnly {
		t.Fatalf("no HttpOnly refresh_token cookie: %+v", rt)
	}
	ref := postJSON(h.auth.Refresh, "/api/auth/refresh", "", rt)
	if ref.Code != http.StatusOK || decodeAuth(t, ref).AccessToken == "" {
		t.Fatalf("refresh with the OIDC session: %d %s", ref.Code, ref.Body.String())
	}

	// Signing in again finds the same account.
	wantRedirect(t, signIn(t, h, idp), "/")
	if n := countRows(t, db, `SELECT COUNT(*) FROM users`); n != 1 {
		t.Errorf("users = %d after second sign-in, want 1", n)
	}
}

func TestOIDCUnknownAccountWithoutAutoProvision(t *testing.T) {
	db := setupDB(t)
	mkUser(t, db, "owner", true)
	idp := newFakeIdP(t)
	h := oidcHandler(t, db, idp, nil)

	rec := signIn(t, h, idp)
	wantRedirect(t, rec, "/?oidc_error=no_account")
	if cookieNamed(rec, "refresh_token") != nil {
		t.Error("refused sign-in still set a session cookie")
	}
}

func TestOIDCAutoProvision(t *testing.T) {
	db := setupDB(t)
	mkUser(t, db, "owner", true)
	idp := newFakeIdP(t)
	idp.groups = []string{"family@idm.example.com"}
	h := oidcHandler(t, db, idp, func(c *config.OIDCConfig) {
		c.AutoProvision = true
		c.AdminGroup = "babytracker_admins@idm.example.com"
	})

	wantRedirect(t, signIn(t, h, idp), "/")
	var admin bool
	if err := db.Get(&admin, `SELECT is_admin FROM users WHERE username = 'alice'`); err != nil {
		t.Fatalf("account not created: %v", err)
	}
	if admin {
		t.Error("provisioned account is admin without being in OIDC_ADMIN_GROUP")
	}

	idp.sub, idp.preferredUsername = "bob-sub", "bob"
	idp.groups = []string{"babytracker_admins@idm.example.com"}
	wantRedirect(t, signIn(t, h, idp), "/")
	if err := db.Get(&admin, `SELECT is_admin FROM users WHERE username = 'bob'`); err != nil || !admin {
		t.Errorf("member of OIDC_ADMIN_GROUP: admin=%v err=%v", admin, err)
	}
}

// A provider account whose username matches an unlinked local account must
// not be signed in as that account — that would be an account takeover for
// anyone able to pick their own username at the provider.
func TestOIDCNeverAdoptsLocalAccountByName(t *testing.T) {
	db := setupDB(t)
	localID := mkUser(t, db, "alice", true)
	idp := newFakeIdP(t)
	h := oidcHandler(t, db, idp, func(c *config.OIDCConfig) { c.AutoProvision = true })

	rec := signIn(t, h, idp)
	wantRedirect(t, rec, "/?oidc_error=username_taken")
	if cookieNamed(rec, "refresh_token") != nil {
		t.Error("session issued for an unlinked local account")
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM user_identities WHERE user_id = $1`, localID); n != 0 {
		t.Error("identity was linked to the local account")
	}
}

func TestOIDCAllowedGroups(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	h := oidcHandler(t, db, idp, func(c *config.OIDCConfig) {
		c.AutoProvision = true
		c.AllowedGroups = []string{"family@idm.example.com"}
	})

	idp.groups = []string{"neighbours@idm.example.com"}
	wantRedirect(t, signIn(t, h, idp), "/?oidc_error=not_allowed")

	// No groups claim at all is not membership either.
	idp.groups = nil
	wantRedirect(t, signIn(t, h, idp), "/?oidc_error=not_allowed")

	// Groups that only come back from userinfo count.
	idp.userinfoGroups = []string{"family@idm.example.com"}
	wantRedirect(t, signIn(t, h, idp), "/")
}

func TestOIDCAdminGroupIsAuthoritative(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	h := oidcHandler(t, db, idp, func(c *config.OIDCConfig) {
		c.AdminGroup = "babytracker_admins@idm.example.com"
	})

	// First account: admin regardless of groups.
	idp.groups = []string{}
	wantRedirect(t, signIn(t, h, idp), "/")
	isAdmin := func() bool {
		var v bool
		db.Get(&v, `SELECT is_admin FROM users WHERE username = 'alice'`)
		return v
	}
	if !isAdmin() {
		t.Fatal("first account isn't admin")
	}

	// Not in the admin group, but the only admin: kept.
	wantRedirect(t, signIn(t, h, idp), "/")
	if !isAdmin() {
		t.Error("the last admin was demoted")
	}

	// With another admin around, the provider's word stands.
	mkUser(t, db, "owner", true)
	wantRedirect(t, signIn(t, h, idp), "/")
	if isAdmin() {
		t.Error("not demoted after leaving OIDC_ADMIN_GROUP")
	}

	// Joining the group promotes.
	idp.groups = []string{"babytracker_admins@idm.example.com"}
	wantRedirect(t, signIn(t, h, idp), "/")
	if !isAdmin() {
		t.Error("not promoted after joining OIDC_ADMIN_GROUP")
	}

	// A response with no groups claim leaves the flag alone.
	idp.groups = nil
	wantRedirect(t, signIn(t, h, idp), "/")
	if !isAdmin() {
		t.Error("demoted on a response without a groups claim")
	}
}

func linkRequest(h *OIDCHandler, userID int, authz string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "http://bt.example/api/auth/oidc/link", nil)
	req.Header.Set("Authorization", authz)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.Link(rec, req)
	return rec
}

func TestOIDCLinkExistingAccount(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	idp.preferredUsername = "alice@idm.example.com" // needn't match the local name
	h := oidcHandler(t, db, idp, nil)
	localID := mkUserWithPassword(t, db, "alice", "Correct-Horse-1")

	// An API token can't link: that would upgrade it to a full sign-in.
	if rec := linkRequest(h, localID, "Token abc"); rec.Code != http.StatusForbidden {
		t.Errorf("link with an API token: got %d, want 403", rec.Code)
	}

	rec := linkRequest(h, localID, "Bearer access-token")
	if rec.Code != http.StatusOK {
		t.Fatalf("link: %d %s", rec.Code, rec.Body.String())
	}
	var body struct{ URL string }
	json.Unmarshal(rec.Body.Bytes(), &body)
	cb := callback(h, idp.authorize(body.URL), cookieNamed(rec, oidcFlowCookie))
	wantRedirect(t, cb, "/?oidc_linked=1")
	if cookieNamed(cb, "refresh_token") != nil {
		t.Error("linking issued a new session")
	}

	// Now the provider account signs in as the local one.
	wantRedirect(t, signIn(t, h, idp), "/")
	if n := countRows(t, db, `SELECT COUNT(*) FROM users`); n != 1 {
		t.Errorf("users = %d, want 1", n)
	}
	if n := countRows(t, db, `SELECT COUNT(*) FROM user_identities WHERE user_id = $1`, localID); n != 1 {
		t.Errorf("identities for alice = %d, want 1", n)
	}

	// Someone else can't link the same provider account.
	bobID := mkUser(t, db, "bob", false)
	rec = linkRequest(h, bobID, "Bearer access-token")
	json.Unmarshal(rec.Body.Bytes(), &body)
	cb = callback(h, idp.authorize(body.URL), cookieNamed(rec, oidcFlowCookie))
	wantRedirect(t, cb, "/?oidc_error=already_linked")
}

func TestPasswordLoginCanBeDisabled(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	mkUserWithPassword(t, db, "alice", "Correct-Horse-1")
	body := `{"username":"alice","password":"Correct-Horse-1"}`

	h := oidcHandler(t, db, idp, func(c *config.OIDCConfig) { c.DisablePasswordLogin = true })
	if rec := postJSON(h.auth.Login, "/api/auth/login", body, nil); rec.Code != http.StatusForbidden {
		t.Errorf("password login with OIDC_DISABLE_PASSWORD_LOGIN: got %d, want 403", rec.Code)
	}
	if rec := postJSON(h.auth.Register, "/api/auth/register", body, nil); rec.Code != http.StatusForbidden {
		t.Errorf("register with OIDC_DISABLE_PASSWORD_LOGIN: got %d, want 403", rec.Code)
	}

	// Without a usable OIDC configuration the switch is ignored, so a typo
	// can't lock everyone out.
	h = oidcHandler(t, db, idp, func(c *config.OIDCConfig) {
		c.DisablePasswordLogin = true
		c.IssuerURL = ""
	})
	if rec := postJSON(h.auth.Login, "/api/auth/login", body, nil); rec.Code != http.StatusOK {
		t.Errorf("password login with OIDC unconfigured: got %d, want 200", rec.Code)
	}
}

func TestOIDCConfidentialClient(t *testing.T) {
	db := setupDB(t)
	idp := newFakeIdP(t)
	idp.secret = "s3cret" // the fake then insists on HTTP Basic client auth
	h := oidcHandler(t, db, idp, nil)
	wantRedirect(t, signIn(t, h, idp), "/")
}
