package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// newTestSPAHandler builds a spaHandler over an in-memory filesystem that
// mimics a Vite build: an index.html plus a hashed asset under /assets.
func newTestSPAHandler() *spaHandler {
	fsys := fstest.MapFS{
		"index.html":                 {Data: []byte("<!doctype html><title>app</title>")},
		"assets/index-ABC123.js":     {Data: []byte("console.log(1)")},
		"assets/index-ABC123.css":    {Data: []byte("body{}")},
		"favicon.ico":                {Data: []byte("icon")},
	}
	staticFS := http.FS(fsys)
	return &spaHandler{staticFS: staticFS, fileServer: http.FileServer(staticFS)}
}

func serve(h *spaHandler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	h.ServeHTTP(rec, req)
	return rec
}

func TestSPAServesExistingAsset(t *testing.T) {
	h := newTestSPAHandler()
	rec := serve(h, "/assets/index-ABC123.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 for existing asset, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("asset body not served: %q", rec.Body.String())
	}
}

// The core regression guard: a missing hashed chunk (stale index.html after a
// redeploy) must 404, not fall back to the HTML index — otherwise the browser
// gets 200 text/html for a .js request and reports a confusing MIME error.
func TestSPAMissingAssetIs404(t *testing.T) {
	h := newTestSPAHandler()
	for _, p := range []string{
		"/assets/index-GONE999.js",
		"/assets/index-GONE999.css",
		"/old-chunk.js",
		"/style.css",
		"/img/photo.png",
	} {
		rec := serve(h, p)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: want 404 for missing asset, got %d", p, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "<!doctype html>") {
			t.Errorf("%s: HTML index served for a missing asset", p)
		}
	}
}

func TestSPAFallbackForNavigationRoutes(t *testing.T) {
	h := newTestSPAHandler()
	// Client-side routes (no file extension) get the SPA index so the app
	// can boot and route on the client.
	for _, p := range []string{"/", "/growth", "/settings/backups", "/some/deep/route"} {
		rec := serve(h, p)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: want 200 (index) for navigation route, got %d", p, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "<!doctype html>") {
			t.Errorf("%s: expected SPA index HTML, got %q", p, rec.Body.String())
		}
	}
}

func TestIsStaticAssetPath(t *testing.T) {
	assets := []string{"/assets/x.js", "/foo.js", "/a.css", "/b.png", "/c.woff2", "/d.map", "/e.WASM"}
	for _, p := range assets {
		if !isStaticAssetPath(p) {
			t.Errorf("%s should be treated as a static asset", p)
		}
	}
	routes := []string{"/", "/growth", "/settings", "/child/5"}
	for _, p := range routes {
		if isStaticAssetPath(p) {
			t.Errorf("%s should be treated as a navigation route", p)
		}
	}
}
