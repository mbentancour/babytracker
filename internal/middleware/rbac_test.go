package middleware

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// rbacRequest runs a request through RBAC with the given auth context.
// These tests only exercise decision paths that never touch the database
// (admin bypass, path allowlists, static denials), so a nil DB is safe —
// reaching a DB-backed path would panic and fail the test loudly.
func rbacRequest(t *testing.T, method, path string, isAdmin bool, body string) (*httptest.ResponseRecorder, *okHandler) {
	t.Helper()
	next := &okHandler{}
	rec := httptest.NewRecorder()

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	ctx := context.WithValue(req.Context(), UserIDKey, 7)
	ctx = context.WithValue(ctx, IsAdminKey, isAdmin)
	req = req.WithContext(ctx)

	RBAC(nil)(next).ServeHTTP(rec, req)
	return rec, next
}

func TestRBACAdminBypassesEverything(t *testing.T) {
	// Even an unknown path (which would 403 for non-admins) passes for admins.
	rec, next := rbacRequest(t, http.MethodDelete, "/api/unknown-endpoint", true, "")
	if rec.Code != http.StatusOK || !next.called {
		t.Fatalf("admin should bypass RBAC: got %d", rec.Code)
	}
}

func TestRBACBypassPaths(t *testing.T) {
	for _, path := range []string{"/api/config", "/api/auth/refresh", "/api/users/me", "/api/display/events"} {
		rec, next := rbacRequest(t, http.MethodGet, path, false, "")
		if rec.Code != http.StatusOK || !next.called {
			t.Errorf("%s: bypass path blocked for non-admin: got %d", path, rec.Code)
		}
	}
}

func TestRBACAdminWritePathsDenyNonAdminWrites(t *testing.T) {
	for _, path := range []string{"/api/children/", "/api/users/", "/api/webhooks/", "/api/tokens/", "/api/roles/"} {
		rec, next := rbacRequest(t, http.MethodPost, path, false, "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s: non-admin write allowed: got %d", path, rec.Code)
		}
		if next.called {
			t.Errorf("POST %s: handler reached despite denial", path)
		}
	}
}

func TestRBACAdminWritePathsAllowNonAdminReads(t *testing.T) {
	for _, path := range []string{"/api/children/", "/api/tags/"} {
		rec, next := rbacRequest(t, http.MethodGet, path, false, "")
		if rec.Code != http.StatusOK || !next.called {
			t.Errorf("GET %s: non-admin read blocked: got %d", path, rec.Code)
		}
	}
}

// Per-entity tag operations (/api/tags/<entityType>/<entityId>/...) are
// enforced by the handlers, not by the admin gate; tag *management*
// (/api/tags/, /api/tags/{id}/) stays admin-only.
func TestRBACTagCarveOut(t *testing.T) {
	rec, next := rbacRequest(t, http.MethodPost, "/api/tags/feeding/5/", false, "")
	if rec.Code != http.StatusOK || !next.called {
		t.Fatalf("per-entity tag op should pass RBAC (handler enforces): got %d", rec.Code)
	}

	rec, _ = rbacRequest(t, http.MethodPost, "/api/tags/", false, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("tag management should stay admin-only: got %d", rec.Code)
	}
}

func TestRBACUnknownPathDeniedByDefault(t *testing.T) {
	rec, next := rbacRequest(t, http.MethodGet, "/api/does-not-exist", false, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unknown path should be denied for non-admins: got %d", rec.Code)
	}
	if next.called {
		t.Fatal("handler reached despite denial")
	}
}

func TestRBACMediaPathsPass(t *testing.T) {
	rec, next := rbacRequest(t, http.MethodGet, "/api/media/photos/1.jpg", false, "")
	if rec.Code != http.StatusOK || !next.called {
		t.Fatalf("media path should pass for authenticated users: got %d", rec.Code)
	}
}

func TestGetChildIDFromQueryParam(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/feedings/?child=12", nil)
	if got := getChildIDFromRequest(req); got != 12 {
		t.Fatalf("want 12, got %d", got)
	}
}

func TestGetChildIDFromJSONBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/feedings/", strings.NewReader(`{"child":3,"amount":120}`))
	req.Header.Set("Content-Type", "application/json")
	if got := getChildIDFromRequest(req); got != 3 {
		t.Fatalf("want 3, got %d", got)
	}
}

// Peeking at the body must not consume it — the handler downstream still
// needs to decode the full JSON payload.
func TestGetChildIDPreservesBody(t *testing.T) {
	payload := `{"child":3,"amount":120}`
	req := httptest.NewRequest(http.MethodPost, "/api/feedings/", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	getChildIDFromRequest(req)

	rest, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(rest) != payload {
		t.Fatalf("body consumed by peek: got %q", rest)
	}
}

func TestGetChildIDIgnoresNonJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/feedings/", strings.NewReader(`child=3`))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if got := getChildIDFromRequest(req); got != 0 {
		t.Fatalf("want 0 for non-JSON body, got %d", got)
	}
}

func TestGetChildIDInvalidValues(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/feedings/?child=abc", nil)
	if got := getChildIDFromRequest(req); got != 0 {
		t.Fatalf("want 0 for non-numeric child, got %d", got)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/feedings/", strings.NewReader(`{"child":-1}`))
	req.Header.Set("Content-Type", "application/json")
	if got := getChildIDFromRequest(req); got != 0 {
		t.Fatalf("want 0 for negative child in body, got %d", got)
	}
}
