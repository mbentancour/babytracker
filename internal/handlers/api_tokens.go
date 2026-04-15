package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type APITokensHandler struct {
	db *sqlx.DB
}

func NewAPITokensHandler(db *sqlx.DB) *APITokensHandler {
	return &APITokensHandler{db: db}
}

func (h *APITokensHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	tokens, err := models.ListAPITokens(h.db, userID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list tokens")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(tokens),
		Results: tokens,
	})
}

type createTokenResponse struct {
	models.APIToken
	Token string `json:"token"`
}

func (h *APITokensHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var input models.APITokenInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}

	rawToken, err := crypto.GenerateRefreshToken()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	permissions := input.Permissions
	if permissions == "" {
		permissions = "read"
	}

	// Parse optional expiry (ISO-8601 / RFC 3339). Nil = no expiry (legacy
	// behaviour). Tokens with an expires_at in the past are rejected up-front
	// so the UI always gets a clear error, and the DB row never exists.
	var expiresAt *time.Time
	if input.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, input.ExpiresAt)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "expires_at must be RFC 3339 (e.g. 2026-12-31T00:00:00Z)")
			return
		}
		if t.Before(time.Now()) {
			pagination.WriteError(w, http.StatusBadRequest, "expires_at is in the past")
			return
		}
		expiresAt = &t
	}

	token := models.APIToken{
		UserID:      userID,
		Name:        input.Name,
		TokenHash:   crypto.HashRefreshToken(rawToken),
		Permissions: permissions,
		ExpiresAt:   expiresAt,
	}

	if err := models.CreateAPIToken(h.db, &token); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create token")
		return
	}

	// Return the raw token only on creation — it can't be retrieved later
	pagination.WriteJSON(w, http.StatusCreated, createTokenResponse{
		APIToken: token,
		Token:    rawToken,
	})
}

func (h *APITokensHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	userID := middleware.GetUserID(r.Context())
	if err := models.DeleteAPIToken(h.db, id, userID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
