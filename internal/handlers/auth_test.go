package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
)

// These cover the Home Assistant ingress session path. Inside the ingress
// iframe the browser routinely drops the refresh cookie, which used to sign
// households out roughly hourly: the access token persisted in localStorage
// lasted an hour, and renewing it fell back on the very cookie that had gone
// missing. Under ingress the refresh token now travels in the response body
// and comes back in the request body.

func authHandler(t *testing.T, db *sqlx.DB, inIngress bool) *AuthHandler {
	t.Helper()
	h := NewAuthHandler(db, &config.Config{JWTSecret: "test-secret-for-auth-tests"})
	h.inIngress = inIngress
	return h
}

func mkUserWithPassword(t *testing.T, db *sqlx.DB, username, password string) int {
	t.Helper()
	hash, err := crypto.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	var id int
	if err := db.Get(&id,
		`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id`,
		username, hash); err != nil {
		t.Fatalf("mkUserWithPassword: %v", err)
	}
	return id
}

func postJSON(h http.HandlerFunc, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func decodeAuth(t *testing.T, rec *httptest.ResponseRecorder) authResponse {
	t.Helper()
	var resp authResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode auth response: %v (body: %s)", err, rec.Body.String())
	}
	return resp
}

// issueSession logs a user in and returns the refresh token, taking it from
// the response body under ingress and from the Set-Cookie header otherwise.
func issueSession(t *testing.T, h *AuthHandler, username, password string) (authResponse, string) {
	t.Helper()
	rec := postJSON(h.Login, "/api/auth/login",
		fmt.Sprintf(`{"username":%q,"password":%q}`, username, password), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	resp := decodeAuth(t, rec)

	cookieValue := ""
	for _, c := range rec.Result().Cookies() {
		if c.Name == "refresh_token" {
			cookieValue = c.Value
		}
	}
	return resp, cookieValue
}

const testPassword = "correct-horse-battery-staple"

func TestRefreshAcceptsBodyTokenUnderIngress(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)

	resp, _ := issueSession(t, h, "parent", testPassword)
	if resp.RefreshToken == "" {
		t.Fatal("no refresh_token in the login response under ingress")
	}

	// No cookie at all — the case the ingress iframe actually produces.
	rec := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, resp.RefreshToken), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh by body token: got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	refreshed := decodeAuth(t, rec)
	if refreshed.AccessToken == "" {
		t.Error("refresh returned no access token")
	}
	if refreshed.RefreshToken == "" || refreshed.RefreshToken == resp.RefreshToken {
		t.Error("refresh should rotate and return a new refresh token under ingress")
	}
}

// The body token is the client's own copy and is the one it manages. A cookie
// the browser kept from before a dropped Set-Cookie points at a row that has
// already been rotated away, so preferring it would reject a live session.
func TestRefreshPrefersBodyTokenOverStaleCookie(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)

	resp, _ := issueSession(t, h, "parent", testPassword)

	stale := &http.Cookie{Name: "refresh_token", Value: "a-token-that-was-rotated-away"}
	rec := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, resp.RefreshToken), stale)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 — the body token should win (body: %s)", rec.Code, rec.Body.String())
	}
}

// Outside HA the cookie works and is HttpOnly. Handing the token to script
// there would give up that protection for nothing, so the field stays empty
// and a body token is ignored.
func TestRefreshTokenStaysInCookieOutsideIngress(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, false)
	mkUserWithPassword(t, db, "parent", testPassword)

	resp, cookieValue := issueSession(t, h, "parent", testPassword)
	if resp.RefreshToken != "" {
		t.Error("refresh_token must not be returned in the body outside ingress")
	}
	if cookieValue == "" {
		t.Fatal("no refresh_token cookie was set")
	}

	// A body token must not be honoured here.
	rec := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, cookieValue), nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401 — body tokens are ingress-only", rec.Code)
	}

	// The cookie still works.
	ok := postJSON(h.Refresh, "/api/auth/refresh", "",
		&http.Cookie{Name: "refresh_token", Value: cookieValue})
	if ok.Code != http.StatusOK {
		t.Fatalf("cookie refresh: got %d, want 200 (body: %s)", ok.Code, ok.Body.String())
	}
}

func TestRefreshWithNoTokenIsUnauthorized(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)

	rec := postJSON(h.Refresh, "/api/auth/refresh", `{}`, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", rec.Code)
	}
}

// Signing out has to revoke the session server-side even when there was never
// a cookie, or the add-on would leave a working 30-day token behind.
func TestLogoutRevokesBodyTokenUnderIngress(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)

	resp, _ := issueSession(t, h, "parent", testPassword)

	out := postJSON(h.Logout, "/api/auth/logout",
		fmt.Sprintf(`{"refresh_token":%q}`, resp.RefreshToken), nil)
	if out.Code != http.StatusNoContent {
		t.Fatalf("logout: got %d, want 204", out.Code)
	}

	var count int
	if err := db.Get(&count, `SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = $1`,
		crypto.HashRefreshToken(resp.RefreshToken)); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatal("logout left the refresh token live on the server")
	}
}

// Under ingress every request carries the Supervisor's address, so an IP-keyed
// login limit was one allowance for the whole household: after a mass sign-out
// the family locked each other out of signing back in. Keyed by account, one
// person's failures no longer touch anyone else's budget.
func TestLoginRateLimitIsPerAccount(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)
	mkUserWithPassword(t, db, "partner", testPassword)

	// Burn the budget for one account with wrong passwords.
	limited := false
	for i := 0; i < 12; i++ {
		rec := postJSON(h.Login, "/api/auth/login", `{"username":"parent","password":"wrong"}`, nil)
		if rec.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("expected the account to be throttled after repeated failures")
	}

	// The other account is unaffected.
	rec := postJSON(h.Login, "/api/auth/login",
		fmt.Sprintf(`{"username":"partner","password":%q}`, testPassword), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("second account: got %d, want 200 — buckets must not be shared (body: %s)",
			rec.Code, rec.Body.String())
	}
}

// Same key/value pair, different case or padding, is the same account.
func TestLoginRateLimitKeyIsNormalised(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)

	for i := 0; i < 10; i++ {
		postJSON(h.Login, "/api/auth/login", `{"username":"parent","password":"wrong"}`, nil)
	}
	rec := postJSON(h.Login, "/api/auth/login", `{"username":"  PARENT ","password":"wrong"}`, nil)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d, want 429 — case and padding must not buy a fresh bucket", rec.Code)
	}
}

func TestRefreshRateLimitIsPerUser(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)
	mkUserWithPassword(t, db, "partner", testPassword)

	busy, _ := issueSession(t, h, "parent", testPassword)
	quiet, _ := issueSession(t, h, "partner", testPassword)

	// Hammer one session, re-presenting the newest token after each rotation.
	// The limiter has to key on the user for this to cap anything: keyed by
	// token, rotation would hand every attempt a fresh bucket.
	token := busy.RefreshToken
	limited := false
	for i := 0; i < 60; i++ {
		rec := postJSON(h.Refresh, "/api/auth/refresh",
			fmt.Sprintf(`{"refresh_token":%q}`, token), nil)
		if rec.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
		if rec.Code == http.StatusOK {
			token = decodeAuth(t, rec).RefreshToken
		}
	}
	if !limited {
		t.Fatal("expected the user to be throttled")
	}

	// The other household member carries on. This is the case that used to
	// break: one tablet's burst emptied the shared bucket and everyone got a
	// 429, which the client then read as "your session is gone".
	rec := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, quiet.RefreshToken), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("second session: got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// The rotation grace period exists so multi-tab and poll-during-wake races
// don't fail; check it still holds with the body-token path.
func TestRotatedTokenStaysValidDuringGrace(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)
	mkUserWithPassword(t, db, "parent", testPassword)

	resp, _ := issueSession(t, h, "parent", testPassword)

	first := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, resp.RefreshToken), nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first refresh: got %d, want 200", first.Code)
	}

	// A second tab that still holds the pre-rotation token must not be kicked.
	second := postJSON(h.Refresh, "/api/auth/refresh",
		fmt.Sprintf(`{"refresh_token":%q}`, resp.RefreshToken), nil)
	if second.Code != http.StatusOK {
		t.Fatalf("refresh with the just-rotated token: got %d, want 200", second.Code)
	}
}

func TestRefreshRejectsUnknownToken(t *testing.T) {
	db := setupDB(t)
	h := authHandler(t, db, true)

	rec := postJSON(h.Refresh, "/api/auth/refresh",
		`{"refresh_token":"not-a-real-token"}`, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", rec.Code)
	}
}
