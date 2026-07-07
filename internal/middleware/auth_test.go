package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/mbentancour/babytracker/internal/crypto"
)

const testSecret = "test-secret-0123456789abcdef"

// okHandler records that the request made it through the middleware and
// captures the auth context values for assertions.
type okHandler struct {
	called   bool
	userID   int
	username string
	isAdmin  bool
}

func (h *okHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.called = true
	h.userID = GetUserID(r.Context())
	h.username, _ = r.Context().Value(UsernameKey).(string)
	h.isAdmin, _ = r.Context().Value(IsAdminKey).(bool)
	w.WriteHeader(http.StatusOK)
}

func authRequest(t *testing.T, header string) *httptest.ResponseRecorder {
	t.Helper()
	next := &okHandler{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	Auth(testSecret, nil)(next).ServeHTTP(rec, req)
	return rec
}

func TestAuthMissingHeader(t *testing.T) {
	rec := authRequest(t, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAuthMalformedHeader(t *testing.T) {
	rec := authRequest(t, "Bearer") // no space, no token
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAuthUnknownScheme(t *testing.T) {
	rec := authRequest(t, "Basic dXNlcjpwYXNz")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAuthValidBearerToken(t *testing.T) {
	token, err := crypto.GenerateAccessToken(testSecret, 42, "alice", true)
	if err != nil {
		t.Fatal(err)
	}

	next := &okHandler{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	Auth(testSecret, nil)(next).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !next.called {
		t.Fatal("handler not called")
	}
	if next.userID != 42 || next.username != "alice" || !next.isAdmin {
		t.Fatalf("context mismatch: userID=%d username=%q isAdmin=%v",
			next.userID, next.username, next.isAdmin)
	}
}

func TestAuthWrongSecret(t *testing.T) {
	token, err := crypto.GenerateAccessToken("some-other-secret", 1, "eve", false)
	if err != nil {
		t.Fatal(err)
	}
	rec := authRequest(t, "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged token accepted: want 401, got %d", rec.Code)
	}
}

func TestAuthExpiredToken(t *testing.T) {
	claims := crypto.Claims{
		UserID:   1,
		Username: "alice",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Hour)),
			Issuer:    "babytracker",
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	rec := authRequest(t, "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired token accepted: want 401, got %d", rec.Code)
	}
}

// A token signed with alg=none must never validate, regardless of claims.
// This is the classic JWT algorithm-confusion attack.
func TestAuthNoneAlgorithmRejected(t *testing.T) {
	claims := crypto.Claims{
		UserID:  1,
		IsAdmin: true,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	rec := authRequest(t, "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("alg=none token accepted: want 401, got %d", rec.Code)
	}
}

func TestGetUserIDEmptyContext(t *testing.T) {
	if got := GetUserID(context.Background()); got != 0 {
		t.Fatalf("want 0 for missing user, got %d", got)
	}
}
