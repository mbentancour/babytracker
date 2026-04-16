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

type HeightHandler struct {
	db *sqlx.DB
}

func NewHeightHandler(db *sqlx.DB) *HeightHandler {
	return &HeightHandler{db: db}
}

func (h *HeightHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	pp := pagination.ParseParams(r, "height")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:              "height",
		ChildIDField:       "child_id",
		AccessibleChildren: accessible,
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.Height](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list height")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *HeightHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.HeightInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ht := models.Height{
		ChildID: input.Child,
		Date:    input.Date,
		Height:  input.Height,
		Notes:   input.Notes,
	}

	if err := models.CreateHeight(h.db, &ht); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create height")
		return
	}
	webhooks.Fire("height.created", ht)
	pagination.WriteJSON(w, http.StatusCreated, ht)
}

func (h *HeightHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "height", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"date":   "date",
		"height": "height",
		"notes":  "notes",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateHeight(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update height")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
