package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mbentancour/babytracker/internal/crypto"
)

// A create that would be saved under a child the caller may not write to is
// refused through the whole stack, however the request is put together. The
// RBAC middleware and the handler each read the request for themselves, and
// they do not read it alike: the middleware goes by the query string before
// the body, looks at the body only when it is declared as JSON, and needs
// the whole body to be one JSON value. The handler has the last word, on the
// child it decoded.
func TestCreateForAnotherChildIsRefused(t *testing.T) {
	db := routerTestDB(t)
	cfg, adminToken := importTestAdmin(t, db)
	h := New(db, cfg)

	send := func(token, path, contentType, body string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", contentType)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	child := func(name string) int {
		t.Helper()
		code, out := send(adminToken, "/api/children/", "application/json", `{"first_name":"`+name+`","birth_date":"2026-01-01"}`)
		id, _ := out["id"].(float64)
		if (code != http.StatusCreated && code != http.StatusOK) || id == 0 {
			t.Fatalf("POST /api/children/ for %s = %d %v", name, code, out)
		}
		return int(id)
	}
	mine, other := child("Aria"), child("Bo")

	// The sitter may write everything for Aria and has nothing to do with Bo.
	var sitterID int
	if err := db.Get(&sitterID, `INSERT INTO users (username, password_hash, is_admin) VALUES ('sitter', 'x', false) RETURNING id`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO user_children (user_id, child_id, role_id) SELECT $1, $2, id FROM roles WHERE name = 'parent'`, sitterID, mine); err != nil {
		t.Fatal(err)
	}
	sitter, err := crypto.GenerateAccessToken(cfg.JWTSecret, sitterID, "sitter", false)
	if err != nil {
		t.Fatal(err)
	}

	feeding := func(childID int) string {
		return `{"child":` + itoa(childID) + `,"start":"2026-01-02T08:00:00","end":"2026-01-02T08:15:00","type":"breast milk","method":"bottle","amount":120}`
	}
	stored := func(childID int) int {
		t.Helper()
		var n int
		if err := db.Get(&n, `SELECT count(*) FROM feedings WHERE child_id = $1`, childID); err != nil {
			t.Fatal(err)
		}
		return n
	}
	own := "/api/feedings/?child=" + itoa(mine)

	for _, c := range []struct{ name, path, contentType, body string }{
		{"the other child in the body", "/api/feedings/", "application/json", feeding(other)},
		{"own child in the query string, the other in the body", own, "application/json", feeding(other)},
		{"the same, with a body that is not declared as JSON", own, "text/plain", feeding(other)},
		{"the same, with something after the JSON", own, "application/json", feeding(other) + ` {"more":true}`},
	} {
		if code, out := send(sitter, c.path, c.contentType, c.body); code != http.StatusForbidden {
			t.Errorf("%s: got %d %v, want 403", c.name, code, out)
		}
		if n := stored(other); n != 0 {
			t.Fatalf("%s: %d feedings were stored for the other child", c.name, n)
		}
	}

	// What is allowed still works, with or without the child repeated in
	// the query string.
	for _, path := range []string{"/api/feedings/", own} {
		if code, out := send(sitter, path, "application/json", feeding(mine)); code != http.StatusCreated {
			t.Errorf("POST %s for the sitter's own child = %d %v, want 201", path, code, out)
		}
	}
	if n := stored(mine); n != 2 {
		t.Errorf("%d feedings stored for the sitter's own child, want 2", n)
	}
}
