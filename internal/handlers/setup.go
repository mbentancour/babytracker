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

// Status returns the current setup state, including which network interfaces
// are present and their connectivity status.
func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	connected := false
	out, err := exec.Command("nmcli", "-t", "-f", "STATE", "general").Output()
	if err == nil {
		connected = strings.Contains(string(out), "connected")
	}

	// Detect interfaces and their state
	hasEthernet := false
	ethernetUp := false
	ethernetIP := ""
	hasWifi := false

	devOut, err := exec.Command("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status").Output()
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(devOut)), "\n") {
			parts := strings.SplitN(line, ":", 3)
			if len(parts) < 3 {
				continue
			}
			device, typ, state := parts[0], parts[1], parts[2]
			switch typ {
			case "ethernet":
				hasEthernet = true
				if state == "connected" {
					ethernetUp = true
					ipOut, _ := exec.Command("nmcli", "-t", "-f", "IP4.ADDRESS", "device", "show", device).Output()
					for _, l := range strings.Split(string(ipOut), "\n") {
						if strings.HasPrefix(l, "IP4.ADDRESS") {
							ethernetIP = strings.TrimPrefix(strings.SplitN(l, ":", 2)[1], "")
							ethernetIP = strings.SplitN(ethernetIP, "/", 2)[0]
							break
						}
					}
				}
			case "wifi":
				hasWifi = true
			}
		}
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"setup_mode":     h.cfg.SetupMode,
		"connected":      connected,
		"wifi_connected": connected, // backward compat
		"has_ethernet":   hasEthernet,
		"ethernet_up":    ethernetUp,
		"ethernet_ip":    ethernetIP,
		"has_wifi":       hasWifi,
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
	// Optional static IP config; empty means DHCP
	Address string `json:"address,omitempty"`
	Gateway string `json:"gateway,omitempty"`
	DNS     string `json:"dns,omitempty"`
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

	// Call the setup-wifi script with sudo. Trailing args are optional static config.
	args := []string{"/usr/local/bin/babytracker-setup-wifi.sh", req.SSID, req.Password}
	if req.Address != "" && req.Gateway != "" {
		args = append(args, req.Address, req.Gateway, req.DNS)
	}
	cmd := exec.Command("sudo", args...)
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

type ethernetRequest struct {
	Mode    string `json:"mode"`              // "dhcp" or "static"
	Address string `json:"address,omitempty"` // e.g. "192.168.1.50/24"
	Gateway string `json:"gateway,omitempty"` // e.g. "192.168.1.1"
	DNS     string `json:"dns,omitempty"`     // e.g. "1.1.1.1,8.8.8.8"
}

// EthernetSetup finishes setup using the ethernet connection. With mode=dhcp,
// nothing changes (NetworkManager already auto-acquired an address). With
// mode=static, the wired connection is reconfigured before the AP is torn down.
func (h *SetupHandler) EthernetSetup(w http.ResponseWriter, r *http.Request) {
	var req ethernetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}

	args := []string{"/usr/local/bin/babytracker-setup-ethernet.sh", req.Mode}
	if req.Mode == "static" {
		if req.Address == "" || req.Gateway == "" {
			pagination.WriteError(w, http.StatusBadRequest, "address and gateway required for static")
			return
		}
		args = append(args, req.Address, req.Gateway, req.DNS)
	}

	cmd := exec.Command("sudo", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "ethernet setup failed: "+string(output))
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Ethernet configured. BabyTracker is now available on your network.",
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
