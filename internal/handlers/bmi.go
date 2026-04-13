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

type BMIHandler struct {
	db *sqlx.DB
}

func NewBMIHandler(db *sqlx.DB) *BMIHandler {
	return &BMIHandler{db: db}
}

func (h *BMIHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "bmi")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "bmi",
		ChildIDField: "child_id",
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.BMI](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list bmi")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *BMIHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.BMIInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	b := models.BMI{
		ChildID: input.Child,
		Date:    input.Date,
		BMI:     input.BMI,
		Notes:   input.Notes,
	}

	if err := models.CreateBMI(h.db, &b); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create bmi")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, b)
}

func (h *BMIHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"date":  "date",
		"bmi":   "bmi",
		"notes": "notes",
		"photo": "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateBMI(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update bmi")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *BMIHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteBMI(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete bmi")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
