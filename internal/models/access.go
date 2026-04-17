package models

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

// childOwnedTables maps each child-scoped table to the RBAC feature that
// gates access to it. Used by EnsureRecordWritable to look up the record's
// real owner and check permission — closing the IDOR window where a caller
// could supply any ?child=N they had access to while targeting an arbitrary
// record id.
var childOwnedTables = map[string]string{
	"feedings":           "feeding",
	"sleep":              "sleep",
	"changes":            "diaper",
	"tummy_times":        "tummy",
	"temperature":        "temp",
	"weight":             "weight",
	"height":             "height",
	"head_circumference": "headcirc",
	"pumping":            "pumping",
	"bmi":                "bmi",
	"medications":        "medication",
	"milestones":         "milestone",
	"notes":              "note",
	"reminders":          "note",
	"timers":             "feeding",
}

// Sentinel errors returned by EnsureRecordWritable so handlers can map them
// to appropriate HTTP status codes without parsing strings.
var (
	ErrRecordNotFound = errors.New("record not found")
	ErrForbidden      = errors.New("forbidden")
)

// TagEntityTypeToTable maps the user-facing entity_type strings stored in
// entry_tags (see frontend/src/hooks/useBabyData.js tagTypes) to the
// underlying table whose child_id column we join against for tenancy
// scoping. Unknown entity_types must return empty results — never fall back
// to "no filter" (that was the original list-disclosure bug).
var TagEntityTypeToTable = map[string]string{
	"feeding":            "feedings",
	"sleep":              "sleep",
	"diaper":             "changes",
	"tummy_time":         "tummy_times",
	"pumping":            "pumping",
	"temperature":        "temperature",
	"medication":         "medications",
	"note":               "notes",
	"milestone":          "milestones",
	"weight":             "weight",
	"height":             "height",
	"head_circumference": "head_circumference",
	"bmi":                "bmi",
}

// GetRecordChildID returns the child_id a row belongs to. Table name must be
// in the child-owned allow-list — the fmt.Sprintf is safe because of that
// check.
func GetRecordChildID(db *sqlx.DB, table string, id int) (int, error) {
	if _, ok := childOwnedTables[table]; !ok {
		return 0, fmt.Errorf("table %q is not child-owned", table)
	}
	var childID int
	err := db.Get(&childID, database.Q(db, fmt.Sprintf("SELECT child_id FROM %s WHERE id = ?", table)), id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrRecordNotFound
	}
	return childID, err
}

// EnsureRecordWritable authorises a mutation (UPDATE/DELETE) on a child-scoped
// record. It looks up the record's real child_id and requires that the user
// has "write" access to that child for the table's feature.
//
// Returns ErrRecordNotFound if the row doesn't exist, ErrForbidden if it does
// but the user can't write it, or a wrapped error for infrastructure failures.
func EnsureRecordWritable(db *sqlx.DB, userID int, table string, id int) error {
	feature, ok := childOwnedTables[table]
	if !ok {
		return fmt.Errorf("table %q is not child-owned", table)
	}
	childID, err := GetRecordChildID(db, table, id)
	if err != nil {
		return err
	}
	if CheckAccess(db, userID, childID, feature) != "write" {
		return ErrForbidden
	}
	return nil
}

// EnsurePhotoWritable authorises a mutation on a row in the photos table,
// whose child relationship is many-to-many via photo_children. Rules:
//   - Admins pass unconditionally (once the photo is confirmed to exist).
//   - Non-admins must have "photo" write access to at least one child the
//     photo is tagged with.
//   - Untagged photos (zero rows in photo_children) are only writable by
//     admins — non-admins get 403. This prevents tag-stripping attacks
//     from orphaning photos into the non-admin-inaccessible set.
func EnsurePhotoWritable(db *sqlx.DB, userID int, photoID int) error {
	var filename string
	err := db.Get(&filename, database.Q(db, `SELECT filename FROM photos WHERE id = ?`), photoID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrRecordNotFound
	}
	if err != nil {
		return err
	}

	var isAdmin bool
	db.Get(&isAdmin, database.Q(db, `SELECT is_admin FROM users WHERE id = ?`), userID)
	if isAdmin {
		return nil
	}

	var childIDs []int
	if err := db.Select(&childIDs,
		database.Q(db, `SELECT child_id FROM photo_children WHERE photo_filename = ?`), filename); err != nil {
		return err
	}
	for _, cid := range childIDs {
		if CheckAccess(db, userID, cid, "photo") == "write" {
			return nil
		}
	}
	return ErrForbidden
}
