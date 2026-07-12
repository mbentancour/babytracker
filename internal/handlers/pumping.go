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

type PumpingHandler struct {
	db *sqlx.DB
}

func NewPumpingHandler(db *sqlx.DB) *PumpingHandler {
	return &PumpingHandler{db: db}
}

func (h *PumpingHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	pp := pagination.ParseParams(r, "pumping")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:              "pumping",
		ChildIDField:       "child_id",
		AccessibleChildren: accessible,
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
	webhooks.Fire("pumping.created", p)
	pagination.WriteJSON(w, http.StatusCreated, p)
}

func (h *PumpingHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "pumping", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"start":  "start_time",
		"end":    "end_time",
		"amount": "amount",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdatePumping(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update pumping")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
