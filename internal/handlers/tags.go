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

type TagsHandler struct {
	db *sqlx.DB
}

func NewTagsHandler(db *sqlx.DB) *TagsHandler {
	return &TagsHandler{db: db}
}

func (h *TagsHandler) List(w http.ResponseWriter, r *http.Request) {
	tags, err := models.ListTags(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list tags")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(tags),
		Results: tags,
	})
}

func (h *TagsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.TagInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}

	tag := models.Tag{
		Name:  input.Name,
		Color: input.Color,
	}
	if tag.Color == "" {
		tag.Color = "#6C5CE7"
	}

	if err := models.CreateTag(h.db, &tag); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create tag")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, tag)
}

func (h *TagsHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	allowed := map[string]string{"name": "name", "color": "color"}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateTag(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update tag")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *TagsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteTag(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete tag")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetEntityTagsBulk returns { "<entity_id>": [tags...] } for every entity of
// the given type that has at least one tag. Designed for list-view rendering
// where fetching tags per row would cost N API calls.
func (h *TagsHandler) GetEntityTagsBulk(w http.ResponseWriter, r *http.Request) {
	entityType := r.URL.Query().Get("entity_type")
	if entityType == "" {
		pagination.WriteError(w, http.StatusBadRequest, "entity_type required")
		return
	}
	m, err := models.GetTagsByEntityType(h.db, entityType)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to load tags")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, m)
}

func (h *TagsHandler) GetEntityTags(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	entityID, err := strconv.Atoi(chi.URLParam(r, "entityId"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid entity id")
		return
	}

	tags, err := models.GetTagsForEntity(h.db, entityType, entityID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to get tags")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, tags)
}

type setTagsRequest struct {
	TagIDs []int `json:"tag_ids"`
}

func (h *TagsHandler) SetEntityTags(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	entityID, err := strconv.Atoi(chi.URLParam(r, "entityId"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid entity id")
		return
	}

	var req setTagsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := models.SetEntityTags(h.db, entityType, entityID, req.TagIDs); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to set tags")
		return
	}

	tags, _ := models.GetTagsForEntity(h.db, entityType, entityID)
	pagination.WriteJSON(w, http.StatusOK, tags)
}
