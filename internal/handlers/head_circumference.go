package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/webhooks"
)

type HeadCircumferenceHandler struct {
	db *sqlx.DB
}

func NewHeadCircumferenceHandler(db *sqlx.DB) *HeadCircumferenceHandler {
	return &HeadCircumferenceHandler{db: db}
}

func (h *HeadCircumferenceHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "head_circumference")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "head_circumference",
		ChildIDField: "child_id",
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.HeadCircumference](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list head circumference")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *HeadCircumferenceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.HeadCircumferenceInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	hc := models.HeadCircumference{
		ChildID:           input.Child,
		Date:              input.Date,
		HeadCircumference: input.HeadCircumference,
		Notes:             input.Notes,
	}

	if err := models.CreateHeadCircumference(h.db, &hc); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create head circumference")
		return
	}
	webhooks.Fire("head_circumference.created", hc)
	pagination.WriteJSON(w, http.StatusCreated, hc)
}

func (h *HeadCircumferenceHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"date":               "date",
		"head_circumference": "head_circumference",
		"notes":              "notes",
		"photo":              "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateHeadCircumference(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update head circumference")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *HeadCircumferenceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteHeadCircumference(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete head circumference")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
