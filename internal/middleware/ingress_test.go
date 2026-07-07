package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func ingressRequest(t *testing.T, haMode bool, path, header string) (gotPath, gotURI string) {
	t.Helper()
	orig := inHAIngress
	inHAIngress = haMode
	defer func() { inHAIngress = orig }()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if header != "" {
		req.Header.Set("X-Ingress-Path", header)
	}
	Ingress(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotURI = r.RequestURI
	})).ServeHTTP(rec, req)
	return gotPath, gotURI
}

// Outside HA the header is attacker-controlled and must be ignored entirely.
func TestIngressHeaderIgnoredOutsideHA(t *testing.T) {
	path, _ := ingressRequest(t, false, "/api/hassio_ingress/tok/api/config", "/api/hassio_ingress/tok")
	if path != "/api/hassio_ingress/tok/api/config" {
		t.Fatalf("path rewritten outside HA mode: %q", path)
	}
}

func TestIngressStripsPrefix(t *testing.T) {
	path, uri := ingressRequest(t, true, "/api/hassio_ingress/tok/api/config?full=1", "/api/hassio_ingress/tok")
	if path != "/api/config" {
		t.Fatalf("want /api/config, got %q", path)
	}
	if uri != "/api/config?full=1" {
		t.Fatalf("query lost in RequestURI: %q", uri)
	}
}

func TestIngressPrefixEqualsPath(t *testing.T) {
	path, _ := ingressRequest(t, true, "/api/hassio_ingress/tok", "/api/hassio_ingress/tok")
	if path != "/" {
		t.Fatalf("bare prefix should map to /: got %q", path)
	}
}

// HA's proxy usually strips the prefix itself; when the path arrives already
// clean the middleware must leave it untouched.
func TestIngressNoOpWhenPrefixAbsent(t *testing.T) {
	path, _ := ingressRequest(t, true, "/api/config", "/api/hassio_ingress/tok")
	if path != "/api/config" {
		t.Fatalf("clean path mangled: %q", path)
	}
}
