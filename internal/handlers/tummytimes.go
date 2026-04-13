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

type TummyTimesHandler struct {
	db *sqlx.DB
}

func NewTummyTimesHandler(db *sqlx.DB) *TummyTimesHandler {
	return &TummyTimesHandler{db: db}
}

func (h *TummyTimesHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "tummy_times")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "tummy_times",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"start_min": "start_time",
			"start_max": "start_time",
		},
	}, pp)

	resp, err := pagination.Execute[models.TummyTime](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list tummy times")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *TummyTimesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.TummyTimeInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t := models.TummyTime{
		ChildID:   input.Child,
		Milestone: input.Milestone,
		Notes:     input.Notes,
	}

	if input.Timer != nil {
		timer, err := models.GetTimer(h.db, *input.Timer)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "timer not found")
			return
		}
		t.Start = timer.Start
		t.End = time.Now()
		t.TimerID = input.Timer
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
		t.Start = start
		t.End = end
	}

	if err := models.CreateTummyTime(h.db, &t); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create tummy time")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, t)
}

func (h *TummyTimesHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"start":     "start_time",
		"end":       "end_time",
		"milestone": "milestone",
		"notes":     "notes",
		"photo":     "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateTummyTime(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update tummy time")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
