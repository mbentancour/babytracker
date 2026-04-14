package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type SetupHandler struct {
	cfg *config.Config
}

func NewSetupHandler(cfg *config.Config) *SetupHandler {
	return &SetupHandler{cfg: cfg}
}

// RequireSetupMode is middleware that blocks requests unless setup mode is active.
func (h *SetupHandler) RequireSetupMode(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.cfg.SetupMode {
			pagination.WriteError(w, http.StatusNotFound, "not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Status returns the current setup state.
func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	wifiConnected := false
	out, err := exec.Command("nmcli", "-t", "-f", "STATE", "general").Output()
	if err == nil {
		wifiConnected = strings.Contains(string(out), "connected")
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"setup_mode":     h.cfg.SetupMode,
		"wifi_connected": wifiConnected,
	})
}

type wifiNetwork struct {
	SSID     string `json:"ssid"`
	Signal   string `json:"signal"`
	Security string `json:"security"`
}

// WifiScan returns available Wi-Fi networks.
func (h *SetupHandler) WifiScan(w http.ResponseWriter, r *http.Request) {
	// Trigger a fresh scan first (ignore errors, scan may already be in progress)
	exec.Command("nmcli", "dev", "wifi", "rescan").Run()

	out, err := exec.Command("nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list").Output()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to scan Wi-Fi networks")
		return
	}

	seen := make(map[string]bool)
	var networks []wifiNetwork
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 || parts[0] == "" {
			continue
		}
		ssid := parts[0]
		if seen[ssid] {
			continue
		}
		seen[ssid] = true
		networks = append(networks, wifiNetwork{
			SSID:     ssid,
			Signal:   parts[1],
			Security: parts[2],
		})
	}

	pagination.WriteJSON(w, http.StatusOK, networks)
}

type wifiConnectRequest struct {
	SSID     string `json:"ssid"`
	Password string `json:"password"`
}

// WifiConnect connects to a Wi-Fi network and completes setup.
func (h *SetupHandler) WifiConnect(w http.ResponseWriter, r *http.Request) {
	var req wifiConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.SSID == "" {
		pagination.WriteError(w, http.StatusBadRequest, "ssid is required")
		return
	}

	// Call the setup-wifi script with sudo
	cmd := exec.Command("sudo", "/usr/local/bin/babytracker-setup-wifi.sh", req.SSID, req.Password)
	output, err := cmd.CombinedOutput()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to connect: "+string(output))
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Wi-Fi connected. BabyTracker is now available on your network.",
	})
}

// Complete marks setup as done by removing the flag file.
func (h *SetupHandler) Complete(w http.ResponseWriter, r *http.Request) {
	flagFile := filepath.Join(h.cfg.DataDir, ".needs-setup")
	if err := os.Remove(flagFile); err != nil && !os.IsNotExist(err) {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to complete setup")
		return
	}
	h.cfg.SetupMode = false
	pagination.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}
