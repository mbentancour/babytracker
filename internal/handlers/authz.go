package handlers

import (
	"errors"
	"net/http"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// ensureWritable authorises a mutation on a child-owned record. The handler
// should call this at the top of UPDATE/DELETE endpoints and bail out when
// it returns false — an appropriate 403/404 response has already been written.
//
// This closes the IDOR where RBAC middleware trusts a caller-supplied
// ?child=N while the record itself belongs to a different child.
func ensureWritable(w http.ResponseWriter, r *http.Request, db *sqlx.DB, table string, id int) bool {
	userID := middleware.GetUserID(r.Context())
	if err := models.EnsureRecordWritable(db, userID, table, id); err != nil {
		switch {
		case errors.Is(err, models.ErrRecordNotFound):
			pagination.WriteError(w, http.StatusNotFound, "not found")
		case errors.Is(err, models.ErrForbidden):
			pagination.WriteError(w, http.StatusForbidden, "forbidden")
		default:
			pagination.WriteError(w, http.StatusInternalServerError, "access check failed")
		}
		return false
	}
	return true
}

// ensurePhotoWritable is the photos-table equivalent of ensureWritable: the
// photo must be tagged (via photo_children) with at least one child the user
// can write to.
func ensurePhotoWritable(w http.ResponseWriter, r *http.Request, db *sqlx.DB, photoID int) bool {
	userID := middleware.GetUserID(r.Context())
	if err := models.EnsurePhotoWritable(db, userID, photoID); err != nil {
		switch {
		case errors.Is(err, models.ErrRecordNotFound):
			pagination.WriteError(w, http.StatusNotFound, "not found")
		case errors.Is(err, models.ErrForbidden):
			pagination.WriteError(w, http.StatusForbidden, "forbidden")
		default:
			pagination.WriteError(w, http.StatusInternalServerError, "access check failed")
		}
		return false
	}
	return true
}

// accessibleChildren returns the caller's accessible child IDs for List-style
// handlers. On lookup failure, writes a 500 response and returns (nil, false);
// the handler should just `return`.
func accessibleChildren(w http.ResponseWriter, r *http.Request, db *sqlx.DB) ([]int, bool) {
	userID := middleware.GetUserID(r.Context())
	ids, err := models.GetAccessibleChildIDs(db, userID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "access check failed")
		return nil, false
	}
	return ids, true
}
