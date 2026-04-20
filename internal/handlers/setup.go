package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// setupScriptTimeout bounds how long a wifi/ethernet handover script may run
// before we abandon it. NetworkManager can block for a long time on a
// misconfigured static IP or unreachable gateway; without this the HTTP
// handler would hang indefinitely and the captive portal would appear dead.
const setupScriptTimeout = 2 * time.Minute

type SetupHandler struct {
	cfg *config.Config
	db  *sqlx.DB
}

func NewSetupHandler(cfg *config.Config, db *sqlx.DB) *SetupHandler {
	return &SetupHandler{cfg: cfg, db: db}
}

// RequireSetupMode is middleware that blocks requests unless setup mode is active.
func (h *SetupHandler) RequireSetupMode(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.cfg.IsSetupMode() {
			pagination.WriteError(w, http.StatusNotFound, "not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Status returns the current setup state, including which network interfaces
// are present and their connectivity status.
func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	// Status is polled by the captive portal every few seconds — a hung nmcli
	// would stack up goroutines and eventually exhaust the worker pool.
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	connected := false
	out, err := exec.CommandContext(ctx, "nmcli", "-t", "-f", "STATE", "general").Output()
	if err == nil {
		connected = strings.Contains(string(out), "connected")
	}

	// Detect interfaces and their state
	hasEthernet := false
	ethernetUp := false
	ethernetIP := ""
	hasWifi := false

	devOut, err := exec.CommandContext(ctx, "nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status").Output()
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
					ipOut, _ := exec.CommandContext(ctx, "nmcli", "-t", "-f", "IP4.ADDRESS", "device", "show", device).Output()
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
		"setup_mode":     h.cfg.IsSetupMode(),
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
	// Cap scan + list at 20s combined: nmcli can hang waiting on a driver
	// that's in the middle of a scan cycle.
	scanCtx, scanCancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer scanCancel()

	// Trigger a fresh scan first (ignore errors, scan may already be in progress)
	exec.CommandContext(scanCtx, "nmcli", "dev", "wifi", "rescan").Run()

	out, err := exec.CommandContext(scanCtx, "nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list").Output()
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
	ctx, cancel := context.WithTimeout(r.Context(), setupScriptTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sudo", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			pagination.WriteError(w, http.StatusGatewayTimeout, "wifi setup timed out")
			return
		}
		pagination.WriteError(w, http.StatusInternalServerError, "failed to connect: "+string(output))
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Wi-Fi connected. BabyTracker is now available on your network.",
		"ip":      detectLANIP(),
		"hostname": detectHostname(),
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

	ctx, cancel := context.WithTimeout(r.Context(), setupScriptTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sudo", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			pagination.WriteError(w, http.StatusGatewayTimeout, "ethernet setup timed out")
			return
		}
		pagination.WriteError(w, http.StatusInternalServerError, "ethernet setup failed: "+string(output))
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"message":  "Ethernet configured. BabyTracker is now available on your network.",
		"ip":       detectLANIP(),
		"hostname": detectHostname(),
	})
}

// detectLANIP returns the first non-loopback, non-wireless IPv4 address.
// Used to tell the user where to reach the device after setup completes.
func detectLANIP() string {
	out, err := exec.Command("ip", "-4", "-o", "addr", "show", "scope", "global").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		dev := fields[1]
		if dev == "lo" || strings.HasPrefix(dev, "wl") {
			// Prefer ethernet over wifi, but fall back to wifi if that's all there is
			continue
		}
		addr := strings.SplitN(fields[3], "/", 2)[0]
		return addr
	}
	// Second pass: accept wifi if no ethernet was found
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || fields[1] == "lo" {
			continue
		}
		return strings.SplitN(fields[3], "/", 2)[0]
	}
	return ""
}

func detectHostname() string {
	out, err := exec.Command("hostname").Output()
	if err != nil {
		return ""
	}
	h := strings.TrimSpace(string(out))
	if h == "" {
		return ""
	}
	return h + ".local"
}

// Complete marks setup as done by removing the flag file. The Pi's
// setup-wifi.sh / setup-ethernet.sh scripts remove this flag themselves at
// the end of a successful network handover, so this endpoint is primarily
// a safety net.
//
// Gated on "at least one user already exists" because during first-boot the
// captive portal is unauthenticated — without this gate an attacker on the
// setup AP could disable setup mode before the owner creates their admin
// account, potentially racing to create their own admin first.
func (h *SetupHandler) Complete(w http.ResponseWriter, r *http.Request) {
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to check users")
		return
	}
	if count == 0 {
		pagination.WriteError(w, http.StatusForbidden, "cannot complete setup before creating the first user account")
		return
	}

	// Flip the in-memory flag first so a concurrent request can't slip
	// through setup-only routes between the file removal and the flag update.
	h.cfg.SetSetupMode(false)
	flagFile := filepath.Join(h.cfg.DataDir, ".needs-setup")
	if err := os.Remove(flagFile); err != nil && !os.IsNotExist(err) {
		h.cfg.SetSetupMode(true) // restore
		pagination.WriteError(w, http.StatusInternalServerError, "failed to complete setup")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}
