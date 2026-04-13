package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type RemindersHandler struct {
	db *sqlx.DB
}

func NewRemindersHandler(db *sqlx.DB) *RemindersHandler {
	return &RemindersHandler{db: db}
}

func (h *RemindersHandler) List(w http.ResponseWriter, r *http.Request) {
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

	reminders, err := models.ListReminders(h.db, childID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list reminders")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(reminders),
		Results: reminders,
	})
}

func (h *RemindersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.ReminderInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Title == "" {
		pagination.WriteError(w, http.StatusBadRequest, "title is required")
		return
	}

	active := true
	if input.Active != nil {
		active = *input.Active
	}

	rem := models.Reminder{
		ChildID:         input.Child,
		Title:           input.Title,
		Type:            input.Type,
		IntervalMinutes: input.IntervalMinutes,
		FixedTime:       input.FixedTime,
		DaysOfWeek:      input.DaysOfWeek,
		Active:          active,
	}

	if err := models.CreateReminder(h.db, &rem); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create reminder")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, rem)
}

func (h *RemindersHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"title":            "title",
		"type":             "type",
		"interval_minutes": "interval_minutes",
		"fixed_time":       "fixed_time",
		"days_of_week":     "days_of_week",
		"active":           "active",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateReminder(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update reminder")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *RemindersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteReminder(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete reminder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
