package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// Map URL path prefixes to feature names for permission checking
var pathFeatureMap = map[string]string{
	"/api/feedings/":           "feeding",
	"/api/sleep/":              "sleep",
	"/api/changes/":            "diaper",
	"/api/tummy-times/":        "tummy",
	"/api/temperature/":        "temp",
	"/api/weight/":             "weight",
	"/api/height/":             "height",
	"/api/head-circumference/": "headcirc",
	"/api/pumping/":            "pumping",
	// Uneaten milk and the stock summary derived from it are gated by the
	// pumping permission — see the note in models/access.go.
	"/api/milk-waste/": "pumping",
	"/api/milk-stock":  "pumping",
	"/api/bmi/":                "bmi",
	"/api/medications/":        "medication",
	"/api/milestones/":         "milestone",
	"/api/notes/":              "note",
	"/api/photos/":             "photo",
	"/api/timers/":             "feeding",
	"/api/gallery/":            "photo",
	"/api/export/csv":          "note", // Export needs at least read access
}

// Paths that bypass RBAC entirely (auth still required)
var bypassPaths = map[string]bool{
	"/api/config":         true,
	"/api/auth/":          true,
	"/api/users/me":       true,
	"/api/display":        true,
	"/api/display/events": true,
	"/api/backups/":       true,
	"/api/import/":        true,
}

// Paths that only admins can write to (GET is open to all authenticated users)
var adminWritePaths = map[string]bool{
	"/api/children/": true,
	"/api/tags/":     true,
	"/api/tokens/":   true,
	"/api/webhooks/": true,
	"/api/users/":    true,
	"/api/roles/":    true,
}

// Action POSTs on an existing timer row. They carry no child in the body or
// query, so like PATCH/DELETE the handler's ensureWritable resolves the row's
// real child_id and checks ownership; the middleware just lets them through.
var timerActionPath = regexp.MustCompile(`^/api/timers/\d+/(pause|resume)/$`)

// RBAC middleware checks per-child, per-feature permissions for non-admin users.
func RBAC(db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			// The child this request names, read at most once: peeking at
			// the body means reading it whole.
			var named requestChild
			namedRead := false
			namedChild := func() requestChild {
				if !namedRead {
					named, namedRead = childFromRequest(r), true
				}
				return named
			}

			// Tell the live-update stream which child a write to a
			// child-owned resource is about (see ChangeScope), so it can
			// wake only the people who can see that child. This comes
			// before the admin bypass because an admin's change matters to
			// the same people as anyone else's. A child can be named in the
			// query string and in the body; both are noted.
			if r.Method != http.MethodGet && featureForPath(path) != "" {
				NoteChangedChild(r.Context(), namedChild().query)
				NoteChangedChild(r.Context(), namedChild().body)
			}

			// Admins bypass all checks
			if isAdmin, ok := r.Context().Value(IsAdminKey).(bool); ok && isAdmin {
				next.ServeHTTP(w, r)
				return
			}

			// Check if this path bypasses RBAC entirely
			for bp := range bypassPaths {
				if path == bp || strings.HasPrefix(path, bp) {
					next.ServeHTTP(w, r)
					return
				}
			}

			// Carve-out: /api/tags/<entityType>/<entityId>/ are per-entity tag
			// operations that use entity-level ownership (handler calls
			// EnsureEntityAccessible / EnsureEntityWritable), not global admin
			// rights. Tag *management* (/api/tags/ and /api/tags/{id}/) stays
			// admin-gated by the adminWritePaths block below. Placed before
			// adminWritePaths because /api/tags/ matches both shapes.
			if strings.HasPrefix(path, "/api/tags/") {
				parts := strings.Split(strings.Trim(path, "/"), "/")
				if len(parts) >= 4 && parts[0] == "api" && parts[1] == "tags" {
					next.ServeHTTP(w, r)
					return
				}
			}

			// Check admin-write paths: non-admins can GET but not POST/PATCH/DELETE
			for awp := range adminWritePaths {
				if path == awp || strings.HasPrefix(path, awp) {
					if r.Method != http.MethodGet {
						pagination.WriteError(w, http.StatusForbidden, "admin access required")
						return
					}
					next.ServeHTTP(w, r)
					return
				}
			}

			// Media paths — authenticated is enough
			if strings.HasPrefix(path, "/api/media/") {
				next.ServeHTTP(w, r)
				return
			}
			// Photo upload/delete on entities: child_id is not in the URL path
			// so we can't pre-compute the RBAC decision here. The handlers
			// (media.go UploadEntryPhoto / DeleteEntryPhoto / UploadMilestonePhoto
			// and photos.go Update/Delete) MUST call ensureWritable or
			// ensurePhotoWritable to enforce per-record ownership themselves.
			// Adding a new /photo-suffix handler without that check reopens
			// the IDOR class fixed in 2026-04.
			if strings.HasSuffix(path, "/photo") {
				next.ServeHTTP(w, r)
				return
			}

			// Determine which feature this request is for
			feature := featureForPath(path)
			if feature == "" {
				// Unknown path — deny by default for non-admins
				pagination.WriteError(w, http.StatusForbidden, "access denied")
				return
			}

			userID := GetUserID(r.Context())

			// Determine child ID from query param or request body
			childID := namedChild().id()
			if childID == 0 && r.Method == http.MethodPost && timerActionPath.MatchString(path) {
				next.ServeHTTP(w, r)
				return
			}
			if childID == 0 {
				// Caller has to have access to at least one child. If they
				// do, we decide how strict to be based on method:
				//   GET    — handler scopes via AccessibleChildren, let it pass.
				//   PATCH  — handler's ensureWritable looks up the record's
				//            real child_id and checks ownership, safe to pass.
				//   DELETE — same as PATCH; the URL carries the entity id and
				//            the handler enforces ownership.
				//   POST   — create handlers take child from the body and
				//            have no existing row to look up; require the
				//            body to include child so we can check it here.
				accessible, _ := models.GetAccessibleChildIDs(db, userID)
				if len(accessible) == 0 {
					pagination.WriteError(w, http.StatusForbidden, "you don't have access to any children")
					return
				}
				switch r.Method {
				case http.MethodGet, http.MethodPatch, http.MethodDelete:
					next.ServeHTTP(w, r)
					return
				default:
					pagination.WriteError(w, http.StatusBadRequest, "child parameter required")
					return
				}
			}

			// Check access for the specific child + feature
			level := models.CheckAccess(db, userID, childID, feature)

			if level == "none" {
				pagination.WriteError(w, http.StatusForbidden, "you don't have access to this child's data")
				return
			}

			// Write operations need "write" level
			if r.Method != http.MethodGet && level != "write" {
				pagination.WriteError(w, http.StatusForbidden, "you have read-only access to this feature")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireFreshAdmin re-checks the current user's admin status against the
// database on every request. The JWT claim carries is_admin for the access
// token's lifetime (15 min) so a demoted admin would otherwise retain privileges
// until expiry — we can't afford that on destructive endpoints (restore,
// destination CRUD, user management, shutdown). Composes on top of Auth.
func RequireFreshAdmin(db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid := GetUserID(r.Context())
			if uid == 0 {
				pagination.WriteError(w, http.StatusUnauthorized, "not authenticated")
				return
			}
			user, err := models.GetUserByID(db, uid)
			if err != nil || user == nil || !user.IsAdmin {
				pagination.WriteError(w, http.StatusForbidden, "admin access required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// featureForPath is the feature whose permission guards a path, or "" for a
// path that is not a child-owned resource.
func featureForPath(path string) string {
	for prefix, f := range pathFeatureMap {
		if strings.HasPrefix(path, prefix) {
			return f
		}
	}
	return ""
}

// requestChild is the child a request names: in its query string, and for a
// POST or PATCH with a JSON body in that body's "child" field. Either is 0
// when absent or unreadable.
type requestChild struct {
	query, body int
}

// id is the child the access check goes by: the query's, failing that the
// body's.
func (c requestChild) id() int {
	if c.query != 0 {
		return c.query
	}
	return c.body
}

// getChildIDFromRequest extracts the child ID from query params or JSON body.
func getChildIDFromRequest(r *http.Request) int {
	return childFromRequest(r).id()
}

// childFromRequest reads both places a request can name its child. Peeking
// at the body leaves it readable for the handler.
func childFromRequest(r *http.Request) requestChild {
	var named requestChild
	if c := r.URL.Query().Get("child"); c != "" {
		if id, err := strconv.Atoi(c); err == nil {
			named.query = id
		}
	}

	// For POST/PATCH with JSON body, peek at the "child" field
	if (r.Method == http.MethodPost || r.Method == http.MethodPatch) &&
		strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return named
		}
		r.Body = io.NopCloser(strings.NewReader(string(body)))

		var parsed struct {
			Child int `json:"child"`
		}
		if json.Unmarshal(body, &parsed) == nil && parsed.Child > 0 {
			named.body = parsed.Child
		}
	}

	return named
}
