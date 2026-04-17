package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type DomainHandler struct {
	db *sqlx.DB
}

func NewDomainHandler(db *sqlx.DB) *DomainHandler {
	return &DomainHandler{db: db}
}

func (h *DomainHandler) Get(w http.ResponseWriter, r *http.Request) {
	var domain string
	h.db.Get(&domain, `SELECT value FROM settings WHERE key = 'tls_domain'`)

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"domain": domain,
	})
}

type setDomainRequest struct {
	Domain string `json:"domain"`
}

func (h *DomainHandler) Set(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req setDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}

	domain := strings.TrimSpace(req.Domain)

	_, err := h.db.Exec(
		database.Q(h.db, `INSERT INTO settings (key, value) VALUES ('tls_domain', ?)
		 ON CONFLICT (key) DO UPDATE SET value = ?`), domain, domain)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save domain")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"domain":  domain,
		"message": "Domain saved. Restart BabyTracker to apply.",
	})
}
