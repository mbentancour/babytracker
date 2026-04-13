package handlers

import (
	"net/http"
	"strconv"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type GalleryHandler struct {
	db *sqlx.DB
}

func NewGalleryHandler(db *sqlx.DB) *GalleryHandler {
	return &GalleryHandler{db: db}
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

	// Union query across all tables that have photos, including child profile
	query := `
		SELECT id, 'profile' AS entity_type, picture AS photo, birth_date::text AS date,
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

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(items),
		Results: items,
	})
}
