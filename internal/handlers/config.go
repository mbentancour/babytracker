package handlers

import (
	"net/http"
	"os"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// haIngress is true when the process is running as a Home Assistant add-on
// (Supervisor sets SUPERVISOR_TOKEN; older versions set HASSIO_TOKEN). The
// frontend uses this to enable localStorage-based session persistence for the
// iframe context where cookies are unreliable.
var haIngress = os.Getenv("SUPERVISOR_TOKEN") != "" || os.Getenv("HASSIO_TOKEN") != ""

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
		"setup_mode":       h.cfg.IsSetupMode(),
		"appliance_mode":   h.cfg.TLSCert != "",
		"ha_ingress":       haIngress,
	})
}
