package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mbentancour/babytracker/internal/middleware"
)

// updateFeeding drives FeedingsHandler.Update as the given user (context set
// the way the Auth middleware would), targeting feeding `id`.
func updateFeeding(t *testing.T, h *FeedingsHandler, userID, id int, body string) *httptest.ResponseRecorder {
	t.Helper()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.Itoa(id))
	req := httptest.NewRequest(http.MethodPatch, "/api/feedings/"+strconv.Itoa(id)+"/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	return rec
}

// TestFeedingUpdateOwnership is the regression guard for the mutation-side
// IDOR fix (EnsureRecordWritable): a non-admin can only PATCH a record
// belonging to a child they have write access to. The record's real child_id
// is looked up server-side, so passing someone else's record id must fail
// regardless of any child param.
func TestFeedingUpdateOwnership(t *testing.T) {
	db := setupDB(t)
	h := NewFeedingsHandler(db)

	childA := mkChild(t, db, "Aria")
	childB := mkChild(t, db, "Bo")

	writeRole := mkRole(t, db, "writer")
	grantPerm(t, db, writeRole, "feeding", "write")
	readRole := mkRole(t, db, "reader")
	grantPerm(t, db, readRole, "feeding", "read")

	// Caregiver has write access to child A only.
	caregiver := mkUser(t, db, "caregiver", false)
	grantChild(t, db, caregiver, childA, writeRole)

	// Read-only user on child A.
	reader := mkUser(t, db, "reader", false)
	grantChild(t, db, reader, childA, readRole)

	feedA := mkFeeding(t, db, childA)
	feedB := mkFeeding(t, db, childB)

	body := `{"amount": 150}`

	cases := []struct {
		name   string
		user   int
		feedID int
		want   int
	}{
		{"write access to own child's feeding", caregiver, feedA, http.StatusOK},
		{"no access to other child's feeding (IDOR)", caregiver, feedB, http.StatusForbidden},
		{"read-only access cannot write", reader, feedA, http.StatusForbidden},
		{"nonexistent record is 404", caregiver, 999999, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := updateFeeding(t, h, c.user, c.feedID, body)
			if rec.Code != c.want {
				t.Fatalf("%s: got %d, want %d (body: %s)", c.name, rec.Code, c.want, rec.Body.String())
			}
		})
	}
}
