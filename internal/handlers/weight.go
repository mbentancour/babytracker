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

type WeightHandler struct {
	db *sqlx.DB
}

func NewWeightHandler(db *sqlx.DB) *WeightHandler {
	return &WeightHandler{db: db}
}

func (h *WeightHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "weight")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "weight",
		ChildIDField: "child_id",
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.Weight](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list weight")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *WeightHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.WeightInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	wt := models.Weight{
		ChildID: input.Child,
		Date:    input.Date,
		Weight:  input.Weight,
		Notes:   input.Notes,
	}

	if err := models.CreateWeight(h.db, &wt); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create weight")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, wt)
}

func (h *WeightHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"date":   "date",
		"weight": "weight",
		"notes":  "notes",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateWeight(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update weight")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
