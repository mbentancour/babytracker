package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type AuthHandler struct {
	db  *sqlx.DB
	cfg *config.Config

	// Keyed by credential rather than by IP. The route-level RateLimit
	// middleware still caps total volume, but under HA ingress its key is the
	// Supervisor's address for the whole household — so on its own it let one
	// device's burst lock everyone else out. These two do the real work:
	// loginLimiter follows the account being guessed at, refreshLimiter the
	// session being renewed.
	loginLimiter   *middleware.Limiter
	refreshLimiter *middleware.Limiter

	// Whether this process is an HA add-on. Held as a field rather than read
	// from middleware at each call so tests can exercise both deployments.
	inIngress bool
}

func NewAuthHandler(db *sqlx.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{
		db:             db,
		cfg:            cfg,
		loginLimiter:   middleware.NewLimiter(10, time.Minute),
		refreshLimiter: middleware.NewLimiter(30, time.Minute),
		inIngress:      middleware.InIngress(),
	}
}

type registerRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	// Only populated under HA ingress — see issueTokens.
	RefreshToken string `json:"refresh_token,omitempty"`
}

// refreshRequest carries the refresh token for clients that can't rely on the
// cookie. Empty everywhere except the HA add-on.
type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// sessionToken finds the refresh token for this request: the cookie normally,
// the request body inside HA ingress where the cookie frequently isn't there.
//
// The body is only consulted under ingress. Elsewhere the cookie works and is
// HttpOnly, and accepting a body token would hand script on the page a way to
// present a credential it is otherwise unable to read.
func (h *AuthHandler) sessionToken(r *http.Request) string {
	cookieToken := ""
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		cookieToken = cookie.Value
	}
	if !h.inIngress {
		return cookieToken
	}

	// Under ingress the client's own copy wins. The browser can drop a
	// Set-Cookie inside the iframe and then go on presenting the stale cookie
	// it kept — whose row was rotated away seconds after the refresh it missed.
	// Preferring the cookie there would reject the one token that is still good.
	var body refreshRequest
	// A missing or unparseable body just means "no token here".
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.RefreshToken != "" {
		return body.RefreshToken
	}
	return cookieToken
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	// Only allow registration if no users exist
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	if count > 0 {
		pagination.WriteError(w, http.StatusForbidden, "registration is disabled after initial setup")
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Username) < 3 {
		pagination.WriteError(w, http.StatusBadRequest, "username must be at least 3 characters")
		return
	}
	if err := crypto.ValidatePassword(req.Password); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	user, err := models.CreateUser(h.db, req.Username, hash, true) // First user is always admin
	if err != nil {
		pagination.WriteError(w, http.StatusConflict, "username already exists")
		return
	}

	h.issueTokens(w, r, user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Throttle per account, not per source address. Guessing at an account
	// necessarily burns that account's budget wherever it comes from, and a
	// household behind one ingress proxy no longer shares a single allowance —
	// which used to mean that after a mass sign-out, four people reaching for
	// their phones could lock each other out of signing back in.
	if !h.loginLimiter.Allow(strings.ToLower(strings.TrimSpace(req.Username))) {
		w.Header().Set("Retry-After", "60")
		pagination.WriteError(w, http.StatusTooManyRequests, "too many sign-in attempts for this account")
		return
	}

	user, err := models.GetUserByUsername(h.db, req.Username)
	if err != nil {
		// Burn the same argon2 work as the real check below — returning
		// early would let an attacker enumerate usernames by timing.
		crypto.FakeVerify(req.Password)
		pagination.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	valid, err := crypto.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		pagination.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	h.issueTokens(w, r, user)
}

// refreshGracePeriod keeps a just-rotated refresh token valid for a short
// window so concurrent refresh calls from the same user (multi-tab, a
// background poll firing during idle-wake, SSE reconnect, HA restart race)
// don't race to failure and get kicked to the login screen. Empirically,
// 10s is comfortably longer than any realistic in-flight window.
const refreshGracePeriod = 10 * time.Second

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	presented := h.sessionToken(r)
	if presented == "" {
		pagination.WriteError(w, http.StatusUnauthorized, "no refresh token")
		return
	}

	tokenHash := crypto.HashRefreshToken(presented)

	rt, err := models.GetRefreshTokenByHash(h.db, tokenHash)
	if err != nil {
		pagination.WriteError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	// Keyed by user, and therefore after the lookup — every success rotates the
	// token, so keying by the token itself would hand each attempt a brand new
	// bucket and cap nothing. Keying by user gives each family member their own
	// allowance instead of the single Supervisor-address bucket they used to
	// share. Nothing is lost by limiting after the lookup: refresh tokens are
	// 32 random bytes, so this is not a guessing surface, and the coarse
	// route-level ceiling still bounds total volume.
	if !h.refreshLimiter.Allow(fmt.Sprintf("user:%d", rt.UserID)) {
		w.Header().Set("Retry-After", "60")
		pagination.WriteError(w, http.StatusTooManyRequests, "too many refresh attempts")
		return
	}

	// Rotate, but keep the old token redeemable for `refreshGracePeriod`
	// before deleting it. Idempotent: if another call already deleted it in
	// the meantime, the DELETE is a no-op.
	go func(hash string) {
		time.Sleep(refreshGracePeriod)
		_ = models.DeleteRefreshToken(h.db, hash)
	}(tokenHash)

	user, err := models.GetUserByID(h.db, rt.UserID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "user not found")
		return
	}

	h.issueTokens(w, r, user)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// Also reads the body under ingress: without a cookie the server would
	// otherwise have no idea which session to revoke, and signing out would
	// leave a working 30-day token behind.
	if presented := h.sessionToken(r); presented != "" {
		_ = models.DeleteRefreshToken(h.db, crypto.HashRefreshToken(presented))
	}

	http.SetCookie(w, h.refreshCookie(r, "", -1))
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Status(w http.ResponseWriter, r *http.Request) {
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"setup_required": count == 0,
	})
}

func (h *AuthHandler) issueTokens(w http.ResponseWriter, r *http.Request, user *models.User) {
	accessToken, err := crypto.GenerateAccessToken(h.cfg.JWTSecret, user.ID, user.Username, user.IsAdmin)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	refreshToken, err := crypto.GenerateRefreshToken()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to generate refresh token")
		return
	}

	tokenHash := crypto.HashRefreshToken(refreshToken)
	expiresAt := time.Now().Add(crypto.RefreshTokenExpiry)
	if err := models.CreateRefreshToken(h.db, user.ID, tokenHash, expiresAt); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to store refresh token")
		return
	}

	http.SetCookie(w, h.refreshCookie(r, refreshToken, int(crypto.RefreshTokenExpiry.Seconds())))

	resp := authResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(crypto.AccessTokenExpiry.Seconds()),
	}

	// Inside the HA ingress iframe the browser regularly drops this cookie, so
	// the refresh token also goes back in the body for the client to store
	// alongside the access token it already keeps there.
	//
	// This is a deliberate trade. It widens what script on the page could
	// exfiltrate from one hour of access to a 30-day session — but only in the
	// deployment where the alternative is the cookie silently vanishing and
	// everyone being signed out roughly hourly. Everywhere else the cookie
	// works, the field stays empty, and the token remains HttpOnly.
	if h.inIngress {
		resp.RefreshToken = refreshToken
	}

	pagination.WriteJSON(w, http.StatusOK, resp)
}

// refreshCookie builds the refresh token cookie with Secure set only over HTTPS.
func (h *AuthHandler) refreshCookie(r *http.Request, value string, maxAge int) *http.Cookie {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	return &http.Cookie{
		Name:     "refresh_token",
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}
