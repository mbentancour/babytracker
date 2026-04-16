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

type MilestonesHandler struct {
	db *sqlx.DB
}

func NewMilestonesHandler(db *sqlx.DB) *MilestonesHandler {
	return &MilestonesHandler{db: db}
}

func (h *MilestonesHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	pp := pagination.ParseParams(r, "milestones")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:              "milestones",
		ChildIDField:       "child_id",
		AccessibleChildren: accessible,
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.Milestone](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list milestones")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *MilestonesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.MilestoneInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Title == "" {
		pagination.WriteError(w, http.StatusBadRequest, "title is required")
		return
	}

	ms := models.Milestone{
		ChildID:     input.Child,
		Date:        input.Date,
		Title:       input.Title,
		Category:    input.Category,
		Description: input.Description,
	}

	if err := models.CreateMilestone(h.db, &ms); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create milestone")
		return
	}
	webhooks.Fire("milestone.created", ms)
	pagination.WriteJSON(w, http.StatusCreated, ms)
}

func (h *MilestonesHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "milestones", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"date":        "date",
		"title":       "title",
		"category":    "category",
		"description": "description",
		"photo":       "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateMilestone(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update milestone")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *MilestonesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "milestones", id) {
		return
	}
	if err := models.DeleteMilestone(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete milestone")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
