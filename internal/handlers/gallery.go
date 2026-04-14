package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
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
	ID         int     `db:"id" json:"id"`
	EntityType string  `db:"entity_type" json:"entity_type"`
	Photo      string  `db:"photo" json:"photo"`
	Date       string  `db:"date" json:"date"`
	Label      string  `db:"label" json:"label"`
	Detail     *string `db:"detail" json:"detail"`
}

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

	// Union query across all tables that have photos, including child profile
	query := `
		SELECT id, 'profile' AS entity_type, picture AS photo, updated_at::date::text AS date,
			CONCAT(first_name, ' ', last_name) AS label, 'Profile photo' AS detail
		FROM children WHERE id = $1 AND picture != ''
		UNION ALL
		SELECT id, 'weight' AS entity_type, photo, date::text AS date,
			CONCAT(weight, ' kg') AS label, notes AS detail
		FROM weight WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'height' AS entity_type, photo, date::text AS date,
			CONCAT(height, ' cm') AS label, notes AS detail
		FROM height WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'head_circumference' AS entity_type, photo, date::text AS date,
			CONCAT(head_circumference, ' cm') AS label, notes AS detail
		FROM head_circumference WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'milestone' AS entity_type, photo, date::text AS date,
			title AS label, description AS detail
		FROM milestones WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'temperature' AS entity_type, photo, time::date::text AS date,
			CONCAT(temperature, '°') AS label, notes AS detail
		FROM temperature WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'medication' AS entity_type, photo, time::date::text AS date,
			name AS label, CONCAT(dosage, ' ', dosage_unit) AS detail
		FROM medications WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'feeding' AS entity_type, photo, start_time::date::text AS date,
			CONCAT(type, ' - ', method) AS label, notes AS detail
		FROM feedings WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'sleep' AS entity_type, photo, start_time::date::text AS date,
			'Sleep' AS label, notes AS detail
		FROM sleep WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'tummy_time' AS entity_type, photo, start_time::date::text AS date,
			'Tummy Time' AS label, milestone AS detail
		FROM tummy_times WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'diaper' AS entity_type, photo, time::date::text AS date,
			'Diaper Change' AS label, notes AS detail
		FROM changes WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'note' AS entity_type, photo, time::date::text AS date,
			'Note' AS label, note AS detail
		FROM notes WHERE child_id = $1 AND photo != ''
		UNION ALL
		SELECT id, 'photo' AS entity_type, filename AS photo, date::text AS date,
			COALESCE(NULLIF(caption, ''), 'Photo') AS label, NULL AS detail
		FROM photos WHERE child_id = $1
		ORDER BY date DESC
	`

	var items []GalleryItem
	if err := h.db.Select(&items, query, childID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to load gallery")
		return
	}
	if items == nil {
		items = []GalleryItem{}
	}

	// Scan PhotosDir for files not tracked in any database table.
	// These are "shared" photos added directly to the folder (e.g., via HA media browser).
	// Build a set of all tracked filenames across all tables.
	var allTrackedFiles []string
	for _, table := range []string{"feedings", "sleep", "changes", "tummy_times", "temperature", "weight", "height", "head_circumference", "pumping", "medications", "milestones", "notes", "bmi"} {
		var files []string
		h.db.Select(&files, "SELECT photo FROM "+table+" WHERE photo != ''")
		allTrackedFiles = append(allTrackedFiles, files...)
	}
	// Standalone photos table
	var photoFiles []string
	h.db.Select(&photoFiles, "SELECT filename FROM photos")
	allTrackedFiles = append(allTrackedFiles, photoFiles...)
	// Child profile pictures
	var profileFiles []string
	h.db.Select(&profileFiles, "SELECT picture FROM children WHERE picture != ''")
	allTrackedFiles = append(allTrackedFiles, profileFiles...)

	tracked := make(map[string]bool, len(allTrackedFiles))
	for _, f := range allTrackedFiles {
		tracked[f] = true
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
			items = append(items, GalleryItem{
				ID:         0,
				EntityType: "shared",
				Photo:      entry.Name(),
				Date:       info.ModTime().Format("2006-01-02"),
				Label:      "Shared Photo",
				Detail:     nil,
			})
		}
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(items),
		Results: items,
	})
}

// Assign claims a shared (untracked) photo by creating a photos table entry for it.
func (h *GalleryHandler) Assign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Child    int    `json:"child"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Child == 0 || req.Filename == "" {
		pagination.WriteError(w, http.StatusBadRequest, "child and filename are required")
		return
	}

	// Validate filename — no path traversal
	cleaned := filepath.Clean(req.Filename)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	// Verify file exists
	fullPath := filepath.Join(h.cfg.PhotosDir(), cleaned)
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		pagination.WriteError(w, http.StatusNotFound, "file not found")
		return
	}

	// Create a photos table entry
	date := info.ModTime().Format("2006-01-02")
	var photo models.Photo
	err = h.db.QueryRowx(
		`INSERT INTO photos (child_id, filename, caption, date) VALUES ($1, $2, '', $3) RETURNING *`,
		req.Child, cleaned, date,
	).StructScan(&photo)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to assign photo")
		return
	}

	pagination.WriteJSON(w, http.StatusCreated, photo)
}
