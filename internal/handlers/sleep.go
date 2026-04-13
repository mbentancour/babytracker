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
)

type SleepHandler struct {
	db *sqlx.DB
}

func NewSleepHandler(db *sqlx.DB) *SleepHandler {
	return &SleepHandler{db: db}
}

func (h *SleepHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "sleep")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "sleep",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"start_min": "start_time",
			"start_max": "start_time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Sleep](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list sleep entries")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *SleepHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.SleepInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	s := models.Sleep{
		ChildID: input.Child,
		Nap:     input.Nap,
		Notes:   input.Notes,
	}

	if input.Timer != nil {
		timer, err := models.GetTimer(h.db, *input.Timer)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "timer not found")
			return
		}
		s.Start = timer.Start
		s.End = time.Now()
		s.TimerID = input.Timer
		_ = models.DeleteTimer(h.db, *input.Timer)
	} else {
		start, err := time.Parse("2006-01-02T15:04:05", input.Start)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "invalid start time")
			return
		}
		end, err := time.Parse("2006-01-02T15:04:05", input.End)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "invalid end time")
			return
		}
		s.Start = start
		s.End = end
	}

	if err := models.CreateSleep(h.db, &s); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create sleep entry")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, s)
}

func (h *SleepHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"start": "start_time",
		"end":   "end_time",
		"nap":   "nap",
		"notes":  "notes",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateSleep(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update sleep entry")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
