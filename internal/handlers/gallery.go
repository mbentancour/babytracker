package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

var imageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
}

type GalleryHandler struct {
	db  *sqlx.DB
	cfg *config.Config
}

func NewGalleryHandler(db *sqlx.DB, cfg *config.Config) *GalleryHandler {
	return &GalleryHandler{db: db, cfg: cfg}
}

type GalleryItem struct {
	ID             int     `db:"id" json:"id"`
	EntityType     string  `db:"entity_type" json:"entity_type"`
	Photo          string  `db:"photo" json:"photo"`
	Date           string  `db:"date" json:"date"`
	Label          string  `db:"label" json:"label"`
	Detail         *string `db:"detail" json:"detail"`
	TaggedChildren []int   `json:"tagged_children,omitempty"`
}

// List returns every photo visible in one child's gallery: their entry photos
// (feeding/sleep/height/…), their profile picture, photos tagged to them in
// photo_children, and untagged "shared" photos.
//
// Deliberate constraint: a photo tagged ONLY to a different child does not
// appear here even if the caller has access to both children. The UI's tag
// toggles only show children the caller can write to, so to add a second
// child's tag, open that first child's gallery (where the photo IS visible)
// and add the second child from there. Documented in USER-GUIDE.md → Photos.
func (h *GalleryHandler) List(w http.ResponseWriter, r *http.Request) {
	childIDStr := r.URL.Query().Get("child")
	if childIDStr == "" {
		pagination.WriteError(w, http.StatusBadRequest, "child parameter is required")
		return
	}
	childID, err := strconv.Atoi(childIDStr)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid child id")
		return
	}

	// Verify the user has access to this child
	userID := middleware.GetUserID(r.Context())
	if models.CheckAccess(h.db, userID, childID, "photo") == "none" {
		pagination.WriteError(w, http.StatusForbidden, "access denied")
		return
	}

	// Union query across all tables that have photos, including child profile.
	// Uses dialect helpers for date casts and string concat so the same query
	// runs on both Postgres (::date::text, CONCAT) and SQLite (date(), ||).
	dc := database.DateCast   // timestamp → date text
	dt := database.DateToText // date column → text
	cc := database.Concat
	query := database.Q(h.db, fmt.Sprintf(`
		SELECT id, 'profile' AS entity_type, picture AS photo, %s AS date,
			%s AS label, 'Profile photo' AS detail
		FROM children WHERE id = ? AND picture != ''
		UNION ALL
		SELECT id, 'weight' AS entity_type, photo, %s AS date,
			%s AS label, notes AS detail
		FROM weight WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'height' AS entity_type, photo, %s AS date,
			%s AS label, notes AS detail
		FROM height WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'head_circumference' AS entity_type, photo, %s AS date,
			%s AS label, notes AS detail
		FROM head_circumference WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'milestone' AS entity_type, photo, %s AS date,
			title AS label, description AS detail
		FROM milestones WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'temperature' AS entity_type, photo, %s AS date,
			%s AS label, notes AS detail
		FROM temperature WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'medication' AS entity_type, photo, %s AS date,
			name AS label, %s AS detail
		FROM medications WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'feeding' AS entity_type, photo, %s AS date,
			%s AS label, notes AS detail
		FROM feedings WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'sleep' AS entity_type, photo, %s AS date,
			'Sleep' AS label, notes AS detail
		FROM sleep WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'tummy_time' AS entity_type, photo, %s AS date,
			'Tummy Time' AS label, milestone AS detail
		FROM tummy_times WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'diaper' AS entity_type, photo, %s AS date,
			'Diaper Change' AS label, notes AS detail
		FROM changes WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT id, 'note' AS entity_type, photo, %s AS date,
			'Note' AS label, note AS detail
		FROM notes WHERE child_id = ? AND photo != ''
		UNION ALL
		SELECT DISTINCT p.id, 'photo' AS entity_type, p.filename AS photo, %s AS date,
			COALESCE(NULLIF(p.caption, ''), 'Photo') AS label, NULL AS detail
		FROM photos p
		JOIN photo_children pc ON pc.photo_filename = p.filename
		WHERE pc.child_id = ?
		ORDER BY date DESC`,
		dc("updated_at"), cc("first_name", "' '", "last_name"),       // profile
		dt("date"), cc("weight", "' kg'"),                             // weight
		dt("date"), cc("height", "' cm'"),                             // height
		dt("date"), cc("head_circumference", "' cm'"),                 // head_circ
		dt("date"),                                                    // milestone
		dc("time"), cc("temperature", "'°'"),                          // temperature
		dc("time"), cc("dosage", "' '", "dosage_unit"),                // medication
		dc("start_time"), cc("type", "' - '", "method"),               // feeding
		dc("start_time"),                                              // sleep
		dc("start_time"),                                              // tummy_time
		dc("time"),                                                    // diaper
		dc("time"),                                                    // note
		dt("p.date"),                                                  // photos
	))

	var items []GalleryItem
	if err := h.db.Select(&items, query, childID, childID, childID, childID, childID, childID, childID, childID, childID, childID, childID, childID, childID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to load gallery")
		return
	}
	if items == nil {
		items = []GalleryItem{}
	}

	// Add photos from the photos table that have NO child tags (shared)
	var sharedDBPhotos []GalleryItem
	h.db.Select(&sharedDBPhotos, fmt.Sprintf(`
		SELECT p.id, 'shared' AS entity_type, p.filename AS photo, %s AS date,
			COALESCE(NULLIF(p.caption, ''), 'Photo') AS label, NULL AS detail
		FROM photos p
		LEFT JOIN photo_children pc ON pc.photo_filename = p.filename
		WHERE pc.id IS NULL
	`, dt("p.date")))
	items = append(items, sharedDBPhotos...)

	// Scan PhotosDir for files not tracked in any database table.
	// These are also "shared" photos — visible to all children until tagged.
	var allTrackedFiles []string
	for _, table := range []string{"feedings", "sleep", "changes", "tummy_times", "temperature", "weight", "height", "head_circumference", "pumping", "medications", "milestones", "notes", "bmi"} {
		var files []string
		h.db.Select(&files, "SELECT photo FROM "+table+" WHERE photo != ''")
		allTrackedFiles = append(allTrackedFiles, files...)
	}
	var photoFiles []string
	h.db.Select(&photoFiles, "SELECT filename FROM photos")
	allTrackedFiles = append(allTrackedFiles, photoFiles...)
	var profileFiles []string
	h.db.Select(&profileFiles, "SELECT picture FROM children WHERE picture != ''")
	allTrackedFiles = append(allTrackedFiles, profileFiles...)

	tracked := make(map[string]bool, len(allTrackedFiles))
	for _, f := range allTrackedFiles {
		tracked[f] = true
	}

	// Build a map of photo_filename -> tagged child IDs
	type photoTag struct {
		Filename string `db:"photo_filename"`
		ChildID  int    `db:"child_id"`
	}
	var tags []photoTag
	h.db.Select(&tags, "SELECT photo_filename, child_id FROM photo_children")
	tagMap := make(map[string][]int)
	for _, t := range tags {
		tagMap[t.Filename] = append(tagMap[t.Filename], t.ChildID)
	}

	photosDir := h.cfg.PhotosDir()
	if entries, err := os.ReadDir(photosDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if !imageExts[ext] {
				continue
			}
			if tracked[entry.Name()] {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			taggedChildren := tagMap[entry.Name()]
			// If tagged with specific children, only show for the requested child
			if len(taggedChildren) > 0 {
				found := false
				for _, cid := range taggedChildren {
					if cid == childID {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}
			entityType := "shared"
			if len(taggedChildren) > 0 {
				entityType = "photo"
			}
			items = append(items, GalleryItem{
				ID:             0,
				EntityType:     entityType,
				Photo:          entry.Name(),
				Date:           info.ModTime().Format("2006-01-02"),
				Label:          "Photo",
				Detail:         nil,
				TaggedChildren: taggedChildren,
			})
		}
	}

	// Also enrich DB-sourced items with their tags
	for i := range items {
		if tc, ok := tagMap[items[i].Photo]; ok && len(items[i].TaggedChildren) == 0 {
			items[i].TaggedChildren = tc
		}
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(items),
		Results: items,
	})
}

// TagPhoto adds or removes child tags on a photo.
// POST /api/gallery/tag
func (h *GalleryHandler) TagPhoto(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filename string `json:"filename"`
		ChildIDs []int  `json:"child_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Filename == "" {
		pagination.WriteError(w, http.StatusBadRequest, "filename is required")
		return
	}

	cleaned := filepath.Clean(req.Filename)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	// Verify file exists
	if _, err := os.Stat(filepath.Join(h.cfg.PhotosDir(), cleaned)); os.IsNotExist(err) {
		pagination.WriteError(w, http.StatusNotFound, "file not found")
		return
	}

	// Authorization: verify user has write access to every target child.
	userID := middleware.GetUserID(r.Context())
	for _, childID := range req.ChildIDs {
		if models.CheckAccess(h.db, userID, childID, "photo") != "write" {
			pagination.WriteError(w, http.StatusForbidden, "you don't have access to one or more of the selected children")
			return
		}
	}

	// Only remove tags the caller is authorised over. Without this filter,
	// a caller could strip tags for children they can't access (e.g. another
	// family's), silently orphaning the photo from those children's galleries.
	var existingTags []int
	if err := h.db.Select(&existingTags,
		database.Q(h.db, `SELECT child_id FROM photo_children WHERE photo_filename = ?`), cleaned); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	removable := make([]int, 0, len(existingTags))
	for _, cid := range existingTags {
		if models.CheckAccess(h.db, userID, cid, "photo") == "write" {
			removable = append(removable, cid)
		}
	}

	tx, err := h.db.Beginx()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback()

	// Delete only the tags the caller owns.
	if len(removable) > 0 {
		placeholders := make([]string, len(removable))
		args := make([]any, 0, len(removable)+1)
		args = append(args, cleaned)
		for i, cid := range removable {
			placeholders[i] = "?"
			args = append(args, cid)
		}
		query := fmt.Sprintf(
			"DELETE FROM photo_children WHERE photo_filename = ? AND child_id IN (%s)",
			strings.Join(placeholders, ","))
		if _, err := tx.Exec(tx.Rebind(query), args...); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to update tags")
			return
		}
	}
	for _, childID := range req.ChildIDs {
		if _, err := tx.Exec(
			tx.Rebind("INSERT INTO photo_children (photo_filename, child_id) VALUES (?, ?) ON CONFLICT DO NOTHING"),
			cleaned, childID); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to update tags")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update tags")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"filename":  cleaned,
		"child_ids": req.ChildIDs,
	})
}
