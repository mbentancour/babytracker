package middleware

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestChangeScopeCollectsEachChildOnce(t *testing.T) {
	ctx, scope := WithChangeScope(context.Background())
	for _, id := range []int{4, 0, -2, 9, 4} {
		NoteChangedChild(ctx, id)
	}
	if got := scope.Children(); !reflect.DeepEqual(got, []int{4, 9}) {
		t.Fatalf("children = %v, want [4 9]", got)
	}
}

// Code that notes a child cannot know whether anyone is collecting: a read
// has no scope, nor has a handler a test calls directly.
func TestNoteChangedChildWithoutAScope(t *testing.T) {
	NoteChangedChild(context.Background(), 4)
}

// scopedAdminRequest runs a request through RBAC as an admin, whose requests
// never reach the database, and returns the children it noted and what was
// left of the body for the handler.
func scopedAdminRequest(t *testing.T, method, path, body string) ([]int, string) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	ctx := context.WithValue(req.Context(), UserIDKey, 7)
	ctx = context.WithValue(ctx, IsAdminKey, true)
	ctx, scope := WithChangeScope(ctx)

	var left string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest, _ := io.ReadAll(r.Body)
		left = string(rest)
	})
	RBAC(nil)(next).ServeHTTP(httptest.NewRecorder(), req.WithContext(ctx))
	return scope.Children(), left
}

// An admin's requests skip every access check, but what they change matters
// to the same people, so the child is noted before that bypass.
func TestRBACNotesTheChildAWriteNames(t *testing.T) {
	body := `{"child":3,"amount":120}`
	children, left := scopedAdminRequest(t, http.MethodPost, "/api/feedings/", body)
	if !reflect.DeepEqual(children, []int{3}) {
		t.Fatalf("children = %v, want [3]", children)
	}
	if left != body {
		t.Fatalf("the handler was left %q of the body, want all of it", left)
	}

	// A child can be named in the query string as well as in the body.
	// Both are noted, so whoever can see either is told.
	children, _ = scopedAdminRequest(t, http.MethodPost, "/api/feedings/?child=1", `{"child":2}`)
	if !reflect.DeepEqual(children, []int{1, 2}) {
		t.Fatalf("children = %v, want [1 2]", children)
	}
}

func TestRBACNotesNothingWhereNoChildIsNamed(t *testing.T) {
	for _, c := range []struct{ method, path, body string }{
		// A read changes nothing.
		{http.MethodGet, "/api/feedings/?child=3", ""},
		// An update or a delete names its record; the handler looks up whose it is.
		{http.MethodPatch, "/api/feedings/5/", `{"amount":130}`},
		{http.MethodDelete, "/api/feedings/5/", ""},
		// Not a child's data, whatever the body happens to say.
		{http.MethodPost, "/api/tags/", `{"child":3,"name":"x"}`},
		{http.MethodPut, "/api/settings/ui", `{"ui":"simple"}`},
	} {
		if children, _ := scopedAdminRequest(t, c.method, c.path, c.body); len(children) != 0 {
			t.Errorf("%s %s noted %v, want nothing", c.method, c.path, children)
		}
	}
}
