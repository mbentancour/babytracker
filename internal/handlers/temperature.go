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

type TemperatureHandler struct {
	db *sqlx.DB
}

func NewTemperatureHandler(db *sqlx.DB) *TemperatureHandler {
	return &TemperatureHandler{db: db}
}

func (h *TemperatureHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "temperature")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "temperature",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"date_min": "time",
			"date_max": "time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Temperature](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list temperature")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *TemperatureHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.TemperatureInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t, err := time.Parse("2006-01-02T15:04:05", input.Time)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid time format")
		return
	}

	temp := models.Temperature{
		ChildID:     input.Child,
		Time:        t,
		Temperature: input.Temperature,
		Notes:       input.Notes,
	}

	if err := models.CreateTemperature(h.db, &temp); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create temperature")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, temp)
}

func (h *TemperatureHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"time":        "time",
		"temperature": "temperature",
		"notes":       "notes",
		"photo":       "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateTemperature(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update temperature")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
