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

type ChangesHandler struct {
	db *sqlx.DB
}

func NewChangesHandler(db *sqlx.DB) *ChangesHandler {
	return &ChangesHandler{db: db}
}

func (h *ChangesHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "changes")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "changes",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"date_min": "time",
			"date_max": "time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Change](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list changes")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *ChangesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.ChangeInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t, err := time.Parse("2006-01-02T15:04:05", input.Time)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid time format")
		return
	}

	c := models.Change{
		ChildID: input.Child,
		Time:    t,
		Wet:     input.Wet,
		Solid:   input.Solid,
		Color:   input.Color,
		Amount:  input.Amount,
		Notes:   input.Notes,
	}

	if err := models.CreateChange(h.db, &c); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create change")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, c)
}

func (h *ChangesHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"time":   "time",
		"wet":    "wet",
		"solid":  "solid",
		"color":  "color",
		"amount": "amount",
		"notes":  "notes",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateChange(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update change")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
