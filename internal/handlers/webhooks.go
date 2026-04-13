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

type WebhooksHandler struct {
	db *sqlx.DB
}

func NewWebhooksHandler(db *sqlx.DB) *WebhooksHandler {
	return &WebhooksHandler{db: db}
}

func (h *WebhooksHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	webhooks, err := models.ListWebhooks(h.db, userID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list webhooks")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(webhooks),
		Results: webhooks,
	})
}

func (h *WebhooksHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var input models.WebhookInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" || input.URL == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name and url are required")
		return
	}

	active := true
	if input.Active != nil {
		active = *input.Active
	}
	events := input.Events
	if events == "" {
		events = "*"
	}

	wh := models.Webhook{
		UserID: userID,
		Name:   input.Name,
		URL:    input.URL,
		Secret: input.Secret,
		Events: events,
		Active: active,
	}

	if err := models.CreateWebhook(h.db, &wh); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create webhook")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, wh)
}

func (h *WebhooksHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	userID := middleware.GetUserID(r.Context())

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"name":   "name",
		"url":    "url",
		"secret": "secret",
		"events": "events",
		"active": "active",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateWebhook(h.db, id, userID, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update webhook")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *WebhooksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	userID := middleware.GetUserID(r.Context())
	if err := models.DeleteWebhook(h.db, id, userID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete webhook")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
