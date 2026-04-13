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

type MedicationsHandler struct {
	db *sqlx.DB
}

func NewMedicationsHandler(db *sqlx.DB) *MedicationsHandler {
	return &MedicationsHandler{db: db}
}

func (h *MedicationsHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "medications")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "medications",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"date_min": "time",
			"date_max": "time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Medication](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list medications")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *MedicationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.MedicationInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}

	t, err := time.Parse("2006-01-02T15:04:05", input.Time)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid time format")
		return
	}

	med := models.Medication{
		ChildID:    input.Child,
		Time:       t,
		Name:       input.Name,
		Dosage:     input.Dosage,
		DosageUnit: input.DosageUnit,
		Notes:      input.Notes,
	}

	if err := models.CreateMedication(h.db, &med); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create medication")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, med)
}

func (h *MedicationsHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"name":        "name",
		"dosage":      "dosage",
		"dosage_unit": "dosage_unit",
		"notes":       "notes",
		"photo":       "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateMedication(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update medication")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *MedicationsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteMedication(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete medication")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
