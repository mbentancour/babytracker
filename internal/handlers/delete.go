package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// GenericDeleteHandler provides DELETE endpoints for entities that don't have
// custom delete logic (unlike timers which already have their own).
type GenericDeleteHandler struct {
	db *sqlx.DB
}

func NewGenericDeleteHandler(db *sqlx.DB) *GenericDeleteHandler {
	return &GenericDeleteHandler{db: db}
}

func (h *GenericDeleteHandler) deleteEntity(table string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "invalid id")
			return
		}
		if err := models.DeleteEntity(h.db, table, id); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to delete")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *GenericDeleteHandler) DeleteFeeding() http.HandlerFunc    { return h.deleteEntity("feedings") }
func (h *GenericDeleteHandler) DeleteSleep() http.HandlerFunc      { return h.deleteEntity("sleep") }
func (h *GenericDeleteHandler) DeleteChange() http.HandlerFunc     { return h.deleteEntity("changes") }
func (h *GenericDeleteHandler) DeleteTummyTime() http.HandlerFunc  { return h.deleteEntity("tummy_times") }
func (h *GenericDeleteHandler) DeleteTemperature() http.HandlerFunc { return h.deleteEntity("temperature") }
func (h *GenericDeleteHandler) DeleteWeight() http.HandlerFunc     { return h.deleteEntity("weight") }
func (h *GenericDeleteHandler) DeleteHeight() http.HandlerFunc     { return h.deleteEntity("height") }
func (h *GenericDeleteHandler) DeletePumping() http.HandlerFunc    { return h.deleteEntity("pumping") }
func (h *GenericDeleteHandler) DeleteNote() http.HandlerFunc       { return h.deleteEntity("notes") }
func (h *GenericDeleteHandler) DeleteChild() http.HandlerFunc      { return h.deleteEntity("children") }
