package handlers

import (
	"net/http"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type ConfigHandler struct {
	cfg *config.Config
}

func NewConfigHandler(cfg *config.Config) *ConfigHandler {
	return &ConfigHandler{cfg: cfg}
}

func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"refresh_interval": h.cfg.RefreshInterval,
		"demo_mode":        h.cfg.DemoMode,
		"unit_system":      h.cfg.UnitSystem,
	})
}
