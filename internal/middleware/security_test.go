package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func securityRequest(t *testing.T, mutate func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if mutate != nil {
		mutate(req)
	}
	SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, req)
	return rec
}

func TestSecurityHeadersSet(t *testing.T) {
	rec := securityRequest(t, nil)

	want := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-XSS-Protection":       "0",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
		"Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s: want %q, got %q", k, v, got)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("CSP missing or malformed: %q", csp)
	}
}

func TestSecurityStandaloneMode(t *testing.T) {
	orig := isHAMode
	isHAMode = false
	defer func() { isHAMode = orig }()

	rec := securityRequest(t, nil)
	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options: want DENY in standalone mode, got %q", got)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("standalone CSP should forbid framing: %q", csp)
	}
}

func TestSecurityHAModeAllowsFraming(t *testing.T) {
	orig := isHAMode
	isHAMode = true
	defer func() { isHAMode = orig }()

	rec := securityRequest(t, nil)
	if got := rec.Header().Get("X-Frame-Options"); got != "" {
		t.Errorf("X-Frame-Options must be absent under HA ingress (iframe), got %q", got)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); strings.Contains(csp, "frame-ancestors") {
		t.Errorf("HA CSP must not restrict frame-ancestors: %q", csp)
	}
}

// HSTS over plain HTTP is ignored by browsers (RFC 6797 §7.2) and must not
// be emitted; over TLS (direct or via trusted proxy header) it must be.
func TestHSTSOnlyOverTLS(t *testing.T) {
	rec := securityRequest(t, nil)
	if got := rec.Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("HSTS emitted over plain HTTP: %q", got)
	}

	rec = securityRequest(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-Proto", "https")
	})
	if got := rec.Header().Get("Strict-Transport-Security"); !strings.Contains(got, "max-age=") {
		t.Errorf("HSTS missing behind TLS-terminating proxy: %q", got)
	}
}

func TestServerHeaderSuppressed(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "leaky/1.0")
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, req)

	if got := rec.Header().Get("Server"); got != "" {
		t.Errorf("Server header leaked: %q", got)
	}
}
