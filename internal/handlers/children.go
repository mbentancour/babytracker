package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type ChildrenHandler struct {
	db *sqlx.DB
}

func NewChildrenHandler(db *sqlx.DB) *ChildrenHandler {
	return &ChildrenHandler{db: db}
}

func (h *ChildrenHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	// Get accessible child IDs for this user (admins get all)
	accessibleIDs, err := models.GetAccessibleChildIDs(h.db, userID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to check access")
		return
	}

	allChildren, err := models.ListChildren(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list children")
		return
	}

	// Filter to only accessible children
	idSet := make(map[int]bool, len(accessibleIDs))
	for _, id := range accessibleIDs {
		idSet[id] = true
	}

	var children []models.Child
	for _, c := range allChildren {
		if idSet[c.ID] {
			children = append(children, c)
		}
	}
	if children == nil {
		children = []models.Child{}
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(children),
		Results: children,
	})
}

func (h *ChildrenHandler) Create(w http.ResponseWriter, r *http.Request) {
	var child models.Child
	if err := json.NewDecoder(r.Body).Decode(&child); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if child.FirstName == "" {
		pagination.WriteError(w, http.StatusBadRequest, "first_name is required")
		return
	}
	if child.BirthDate == "" {
		pagination.WriteError(w, http.StatusBadRequest, "birth_date is required")
		return
	}

	if err := models.CreateChild(h.db, &child); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create child")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, child)
}

func (h *ChildrenHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		"first_name": "first_name",
		"last_name":  "last_name",
		"birth_date": "birth_date",
		"picture":    "picture",
	}

	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	child, err := models.UpdateChild(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update child")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, child)
}

func filterAllowed(body map[string]any, allowed map[string]string) map[string]any {
	updates := make(map[string]any)
	for jsonField, dbField := range allowed {
		if v, ok := body[jsonField]; ok {
			updates[dbField] = v
		}
	}
	return updates
}
