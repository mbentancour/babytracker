package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
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
	"/api/bmi/":                "bmi",
	"/api/medications/":        "medication",
	"/api/milestones/":         "milestone",
	"/api/notes/":              "note",
	"/api/photos/":             "photo",
	"/api/timers/":             "feeding",
	"/api/reminders/":          "note",
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
	"/api/media-scan/":    true,
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

// RBAC middleware checks per-child, per-feature permissions for non-admin users.
func RBAC(db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Admins bypass all checks
			if isAdmin, ok := r.Context().Value(IsAdminKey).(bool); ok && isAdmin {
				next.ServeHTTP(w, r)
				return
			}

			path := r.URL.Path

			// Check if this path bypasses RBAC entirely
			for bp := range bypassPaths {
				if path == bp || strings.HasPrefix(path, bp) {
					next.ServeHTTP(w, r)
					return
				}
			}

			// Check admin-write paths: non-admins can GET but not POST/PATCH/DELETE
			for awp := range adminWritePaths {
				if path == awp || strings.HasPrefix(path, awp) {
					if r.Method != http.MethodGet {
						http.Error(w, `{"error":"admin access required"}`, http.StatusForbidden)
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
			// Photo upload/delete on entities
			if strings.HasSuffix(path, "/photo") {
				// These use the entity type's feature — but the child ID is tricky
				// to extract from photo upload paths, so allow and rely on the
				// entity's own existence check
				next.ServeHTTP(w, r)
				return
			}

			// Determine which feature this request is for
			feature := ""
			for prefix, f := range pathFeatureMap {
				if strings.HasPrefix(path, prefix) {
					feature = f
					break
				}
			}
			if feature == "" {
				// Unknown path — deny by default for non-admins
				http.Error(w, `{"error":"access denied"}`, http.StatusForbidden)
				return
			}

			userID := GetUserID(r.Context())

			// Determine child ID from query param or request body
			childID := getChildIDFromRequest(r)
			if childID == 0 {
				// No child specified — check if user has access to ANY child
				// with the required feature permission
				accessible, _ := models.GetAccessibleChildIDs(db, userID)
				if len(accessible) == 0 {
					http.Error(w, `{"error":"you don't have access to any children"}`, http.StatusForbidden)
					return
				}
				// For GET without child filter, allow — the data will be
				// scoped by the handler's queries anyway
				if r.Method == http.MethodGet {
					next.ServeHTTP(w, r)
					return
				}
				// For writes without a child ID, deny
				http.Error(w, `{"error":"child parameter required"}`, http.StatusBadRequest)
				return
			}

			// Check access for the specific child + feature
			level := models.CheckAccess(db, userID, childID, feature)

			if level == "none" {
				http.Error(w, `{"error":"you don't have access to this child's data"}`, http.StatusForbidden)
				return
			}

			// Write operations need "write" level
			if r.Method != http.MethodGet && level != "write" {
				http.Error(w, `{"error":"you have read-only access to this feature"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// getChildIDFromRequest extracts the child ID from query params or JSON body.
func getChildIDFromRequest(r *http.Request) int {
	// Try query parameter first
	if c := r.URL.Query().Get("child"); c != "" {
		if id, err := strconv.Atoi(c); err == nil {
			return id
		}
	}

	// For POST/PATCH with JSON body, peek at the "child" field
	if (r.Method == http.MethodPost || r.Method == http.MethodPatch) &&
		strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return 0
		}
		r.Body = io.NopCloser(strings.NewReader(string(body)))

		var parsed struct {
			Child int `json:"child"`
		}
		if json.Unmarshal(body, &parsed) == nil && parsed.Child > 0 {
			return parsed.Child
		}
	}

	return 0
}
