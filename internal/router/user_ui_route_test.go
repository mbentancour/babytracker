package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mbentancour/babytracker/internal/crypto"
)

// The per-user UI choice: anyone may set their own, only an admin may set
// someone else's, and the server stores any well-formed id without knowing
// which UIs the frontend ships.
func TestUserUIChoice(t *testing.T) {
	db := routerTestDB(t)
	cfg, adminToken := importTestAdmin(t, db)
	var userID int
	if err := db.Get(&userID, `INSERT INTO users (username, password_hash, is_admin) VALUES ('sitter', 'x', false) RETURNING id`); err != nil {
		t.Fatal(err)
	}
	userToken, err := crypto.GenerateAccessToken(cfg.JWTSecret, userID, "sitter", false)
	if err != nil {
		t.Fatal(err)
	}
	h := New(db, cfg)

	do := func(method, path, token, body string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	stored := func(id int) string {
		t.Helper()
		var ui string
		if err := db.Get(&ui, `SELECT ui FROM users WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		return ui
	}

	// A new user has no choice saved, and /users/me says so.
	if code, me := do(http.MethodGet, "/api/users/me", userToken, ""); code != http.StatusOK || me["ui"] != "" {
		t.Fatalf("GET /users/me = %d, ui %v; want 200 and an empty ui", code, me["ui"])
	}

	// A user sets their own.
	if code, _ := do(http.MethodPut, "/api/users/me/ui", userToken, `{"ui":"simple"}`); code != http.StatusOK {
		t.Fatalf("PUT /users/me/ui = %d, want 200", code)
	}
	if got := stored(userID); got != "simple" {
		t.Fatalf("stored ui = %q, want simple", got)
	}
	if _, me := do(http.MethodGet, "/api/users/me", userToken, ""); me["ui"] != "simple" {
		t.Fatalf("/users/me ui = %v, want simple", me["ui"])
	}

	// They cannot set someone else's.
	var adminID int
	if err := db.Get(&adminID, `SELECT id FROM users WHERE username = 'admin'`); err != nil {
		t.Fatal(err)
	}
	path := func(id int) string { return "/api/users/" + itoa(id) + "/ui" }
	if code, _ := do(http.MethodPut, path(adminID), userToken, `{"ui":"simple"}`); code != http.StatusForbidden {
		t.Fatalf("non-admin PUT on another user = %d, want 403", code)
	}
	if got := stored(adminID); got != "" {
		t.Fatalf("admin's ui changed to %q by a non-admin", got)
	}

	// An admin can, including back to the default.
	if code, _ := do(http.MethodPut, path(userID), adminToken, `{"ui":"full"}`); code != http.StatusOK {
		t.Fatalf("admin PUT = %d, want 200", code)
	}
	if got := stored(userID); got != "full" {
		t.Fatalf("stored ui = %q, want full", got)
	}
	if code, _ := do(http.MethodPut, path(userID), adminToken, `{"ui":""}`); code != http.StatusOK || stored(userID) != "" {
		t.Fatalf("admin reset to default: code %d, stored %q", code, stored(userID))
	}

	// Malformed ids are refused and change nothing.
	for _, bad := range []string{`{"ui":"Has Spaces"}`, `{"ui":"<script>"}`, `{"ui":"` + strings.Repeat("a", 33) + `"}`, `not json`} {
		if code, _ := do(http.MethodPut, "/api/users/me/ui", userToken, bad); code != http.StatusBadRequest {
			t.Errorf("PUT /users/me/ui %s = %d, want 400", bad, code)
		}
	}
	if got := stored(userID); got != "" {
		t.Fatalf("a refused request stored %q", got)
	}

	// A user that does not exist.
	if code, _ := do(http.MethodPut, path(999999), adminToken, `{"ui":"full"}`); code != http.StatusNotFound {
		t.Fatalf("PUT for a missing user = %d, want 404", code)
	}
}

// An admin sets one default UI for the whole installation; every account sees
// it next to its own choice, and only an admin can change it.
func TestDefaultUI(t *testing.T) {
	db := routerTestDB(t)
	cfg, adminToken := importTestAdmin(t, db)
	var userID int
	if err := db.Get(&userID, `INSERT INTO users (username, password_hash, is_admin, ui) VALUES ('sitter', 'x', false, 'full') RETURNING id`); err != nil {
		t.Fatal(err)
	}
	userToken, err := crypto.GenerateAccessToken(cfg.JWTSecret, userID, "sitter", false)
	if err != nil {
		t.Fatal(err)
	}
	h := New(db, cfg)

	do := func(method, path, token, body string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	seen := func(token string) (any, any) {
		t.Helper()
		code, me := do(http.MethodGet, "/api/users/me", token, "")
		if code != http.StatusOK {
			t.Fatalf("GET /api/users/me = %d, want 200", code)
		}
		return me["default_ui"], me["ui"]
	}

	// Nothing set yet: an empty default, which the frontend reads as its own.
	if def, _ := seen(adminToken); def != "" {
		t.Fatalf("default_ui before any is set = %v, want \"\"", def)
	}

	// A non-admin cannot set it.
	if code, _ := do(http.MethodPut, "/api/settings/ui", userToken, `{"ui":"simple"}`); code != http.StatusForbidden {
		t.Fatalf("non-admin PUT /api/settings/ui = %d, want 403", code)
	}
	if def, _ := seen(userToken); def != "" {
		t.Fatalf("default_ui changed to %v by a non-admin", def)
	}

	// An admin can, and everyone sees it — beside, not instead of, their own.
	if code, out := do(http.MethodPut, "/api/settings/ui", adminToken, `{"ui":"simple"}`); code != http.StatusOK || out["ui"] != "simple" {
		t.Fatalf("admin PUT /api/settings/ui = %d %v, want 200 simple", code, out)
	}
	if def, own := seen(adminToken); def != "simple" || own != "" {
		t.Fatalf("admin sees default %v, own %v; want simple and \"\"", def, own)
	}
	if def, own := seen(userToken); def != "simple" || own != "full" {
		t.Fatalf("user sees default %v, own %v; want simple and full", def, own)
	}

	// Setting it again replaces it; "" clears it.
	if code, _ := do(http.MethodPut, "/api/settings/ui", adminToken, `{"ui":"timeline"}`); code != http.StatusOK {
		t.Fatalf("second PUT = %d, want 200", code)
	}
	if def, _ := seen(userToken); def != "timeline" {
		t.Fatalf("default_ui after a second PUT = %v, want timeline", def)
	}
	if code, _ := do(http.MethodPut, "/api/settings/ui", adminToken, `{"ui":""}`); code != http.StatusOK {
		t.Fatalf("clearing PUT = %d, want 200", code)
	}
	if def, _ := seen(userToken); def != "" {
		t.Fatalf("default_ui after clearing = %v, want \"\"", def)
	}

	// Malformed ids are refused and change nothing.
	for _, bad := range []string{`{"ui":"Has Spaces"}`, `{"ui":"<script>"}`, `not json`} {
		if code, _ := do(http.MethodPut, "/api/settings/ui", adminToken, bad); code != http.StatusBadRequest {
			t.Errorf("PUT /api/settings/ui %s = %d, want 400", bad, code)
		}
	}
	if def, _ := seen(userToken); def != "" {
		t.Fatalf("a refused request stored %v", def)
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
