package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/webhooks"
)

type TimersHandler struct {
	db *sqlx.DB
}

func NewTimersHandler(db *sqlx.DB) *TimersHandler {
	return &TimersHandler{db: db}
}

func (h *TimersHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	timers, err := models.ListTimersForChildren(h.db, accessible)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list timers")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(timers),
		Results: timers,
	})
}

func (h *TimersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.TimerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t := models.Timer{
		ChildID: input.Child,
		Name:    input.Name,
		Start:   time.Now(),
	}

	if input.Start != "" {
		parsed, err := time.Parse("2006-01-02T15:04:05", input.Start)
		if err == nil {
			t.Start = parsed
		}
	}

	if err := models.CreateTimer(h.db, &t); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create timer")
		return
	}
	webhooks.Fire("timer.started", t)
	pagination.WriteJSON(w, http.StatusCreated, t)
}

func (h *TimersHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "timers", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"start": "start_time",
		"name":  "name",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateTimer(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update timer")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *TimersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "timers", id) {
		return
	}

	// Snapshot the timer before deleting so subscribers get the full shape
	// (child, name, start). A raw ID would be less useful to the HA integration
	// which resolves timers by child.
	snapshot, _ := models.GetTimer(h.db, id)
	if err := models.DeleteTimer(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete timer")
		return
	}
	if snapshot != nil {
		webhooks.Fire("timer.stopped", snapshot)
	}
	w.WriteHeader(http.StatusNoContent)
}
