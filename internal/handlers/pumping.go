package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type PumpingHandler struct {
	db *sqlx.DB
}

func NewPumpingHandler(db *sqlx.DB) *PumpingHandler {
	return &PumpingHandler{db: db}
}

func (h *PumpingHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "pumping")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "pumping",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"start_min": "start_time",
			"start_max": "start_time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Pumping](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list pumping")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *PumpingHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.PumpingInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

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

	p := models.Pumping{
		ChildID: input.Child,
		Start:   start,
		End:     end,
		Amount:  input.Amount,
	}

	if err := models.CreatePumping(h.db, &p); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create pumping")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, p)
}
