package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type GenericDeleteHandler struct {
	db  *sqlx.DB
	cfg *config.Config
}

func NewGenericDeleteHandler(db *sqlx.DB, cfg *config.Config) *GenericDeleteHandler {
	return &GenericDeleteHandler{db: db, cfg: cfg}
}

func (h *GenericDeleteHandler) deleteEntity(table string) http.HandlerFunc {
	// Tables that have a "photo" column
	hasPhoto := map[string]bool{
		"feedings": true, "sleep": true, "changes": true, "tummy_times": true,
		"temperature": true, "weight": true, "height": true, "head_circumference": true,
		"pumping": true, "medications": true, "milestones": true, "notes": true, "bmi": true,
	}
	// Children use "picture" column instead
	isChild := table == "children"

	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "invalid id")
			return
		}

		// Clean up photo file before deleting the record
		if hasPhoto[table] {
			var photo string
			h.db.Get(&photo, fmt.Sprintf("SELECT photo FROM %s WHERE id = $1", table), id)
			if photo != "" {
				os.Remove(filepath.Join(h.cfg.PhotosDir(), photo))
			}
		}
		if isChild {
			var picture string
			h.db.Get(&picture, `SELECT picture FROM children WHERE id = $1`, id)
			if picture != "" {
				os.Remove(filepath.Join(h.cfg.PhotosDir(), picture))
			}
		}

		if err := models.DeleteEntity(h.db, table, id); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to delete")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *GenericDeleteHandler) DeleteFeeding() http.HandlerFunc     { return h.deleteEntity("feedings") }
func (h *GenericDeleteHandler) DeleteSleep() http.HandlerFunc       { return h.deleteEntity("sleep") }
func (h *GenericDeleteHandler) DeleteChange() http.HandlerFunc      { return h.deleteEntity("changes") }
func (h *GenericDeleteHandler) DeleteTummyTime() http.HandlerFunc   { return h.deleteEntity("tummy_times") }
func (h *GenericDeleteHandler) DeleteTemperature() http.HandlerFunc { return h.deleteEntity("temperature") }
func (h *GenericDeleteHandler) DeleteWeight() http.HandlerFunc      { return h.deleteEntity("weight") }
func (h *GenericDeleteHandler) DeleteHeight() http.HandlerFunc      { return h.deleteEntity("height") }
func (h *GenericDeleteHandler) DeletePumping() http.HandlerFunc     { return h.deleteEntity("pumping") }
func (h *GenericDeleteHandler) DeleteNote() http.HandlerFunc        { return h.deleteEntity("notes") }
func (h *GenericDeleteHandler) DeleteChild() http.HandlerFunc       { return h.deleteEntity("children") }
