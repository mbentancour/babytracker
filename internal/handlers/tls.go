package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/jmoiron/sqlx"
	btacme "github.com/mbentancour/babytracker/internal/acme"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// TLSHandler manages TLS/ACME configuration via the Settings UI.
type TLSHandler struct {
	db       *sqlx.DB
	certsDir string
	mgr      *btacme.Manager // may be nil if ACME was not started at boot
}

func NewTLSHandler(db *sqlx.DB, certsDir string, mgr *btacme.Manager) *TLSHandler {
	return &TLSHandler{db: db, certsDir: certsDir, mgr: mgr}
}

// tlsConfig is the JSON structure stored in the settings table.
type tlsConfig struct {
	Domain      string            `json:"domain"`
	Email       string            `json:"email"`
	Provider    string            `json:"provider"`
	Credentials map[string]string `json:"credentials"`
	ManageA     bool              `json:"manage_a"`
	IP          string            `json:"ip,omitempty"`
}

// providerEnvKeys maps each DNS provider to its required environment variable names.
var providerEnvKeys = map[string][]string{
	"cloudflare": {"CF_DNS_API_TOKEN"},
	"route53":    {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_HOSTED_ZONE_ID"},
	"duckdns":    {"DUCKDNS_TOKEN"},
	"namecheap":  {"NAMECHEAP_API_USER", "NAMECHEAP_API_KEY"},
	"simply":     {"SIMPLY_ACCOUNT_NAME", "SIMPLY_API_KEY"},
}

// Get returns the current TLS configuration with credentials masked.
func (h *TLSHandler) Get(w http.ResponseWriter, r *http.Request) {
	cfg := h.loadConfig()

	resp := map[string]any{
		"domain":          cfg.Domain,
		"email":           cfg.Email,
		"provider":        cfg.Provider,
		"credentials_set": len(cfg.Credentials) > 0,
		"manage_a":        cfg.ManageA,
		"ip":              cfg.IP,
	}

	// Add current certificate info if available
	if h.mgr != nil {
		if info := h.mgr.CertInfo(); info != nil {
			resp["certificate"] = info
		}
	}

	pagination.WriteJSON(w, http.StatusOK, resp)
}

type setTLSRequest struct {
	Domain      string            `json:"domain"`
	Email       string            `json:"email"`
	Provider    string            `json:"provider"`
	Credentials map[string]string `json:"credentials,omitempty"`
	ManageA     *bool             `json:"manage_a,omitempty"`
	IP          string            `json:"ip,omitempty"`
}

// Set saves TLS configuration and triggers certificate issuance.
func (h *TLSHandler) Set(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req setTLSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}

	req.Domain = strings.TrimSpace(req.Domain)
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))

	// Validate provider
	if req.Provider != "" {
		if _, ok := providerEnvKeys[req.Provider]; !ok {
			pagination.WriteError(w, http.StatusBadRequest, "unsupported DNS provider")
			return
		}
	}

	// If no new credentials provided, preserve existing ones
	if len(req.Credentials) == 0 {
		existing := h.loadConfig()
		req.Credentials = existing.Credentials
	}

	// Resolve manage_a: default true if not explicitly set
	manageA := true
	if req.ManageA != nil {
		manageA = *req.ManageA
	} else {
		// Preserve existing setting
		existing := h.loadConfig()
		manageA = existing.ManageA
	}

	// Build config for storage
	cfg := tlsConfig{
		Domain:      req.Domain,
		Email:       req.Email,
		Provider:    req.Provider,
		Credentials: req.Credentials,
		ManageA:     manageA,
		IP:          req.IP,
	}

	// Save to database
	data, err := json.Marshal(cfg)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to encode config")
		return
	}
	_, err = h.db.Exec(
		`INSERT INTO settings (key, value) VALUES ('tls_config', $1)
		 ON CONFLICT (key) DO UPDATE SET value = $1`, string(data))
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save TLS config")
		return
	}

	// Also save domain to tls_domain for backward compat
	h.db.Exec(
		`INSERT INTO settings (key, value) VALUES ('tls_domain', $1)
		 ON CONFLICT (key) DO UPDATE SET value = $1`, cfg.Domain)

	// If provider and domain are set, trigger ACME
	if cfg.Domain != "" && cfg.Provider != "" {
		// Set provider credentials as env vars (lego reads them from env)
		for k, v := range cfg.Credentials {
			os.Setenv(k, v)
		}

		acmeCfg := btacme.Config{
			Domain:   cfg.Domain,
			Email:    cfg.Email,
			Provider: cfg.Provider,
			CertsDir: h.certsDir,
			ManageA:  cfg.ManageA,
			IP:       cfg.IP,
		}

		if h.mgr != nil {
			h.mgr.Reconfigure(acmeCfg)
		} else {
			// ACME manager wasn't started at boot — create and start one
			mgr, err := btacme.NewManager(acmeCfg)
			if err != nil {
				pagination.WriteJSON(w, http.StatusOK, map[string]any{
					"saved":   true,
					"error":   err.Error(),
					"message": "Configuration saved. Restart BabyTracker to apply.",
				})
				return
			}
			mgr.Run()
			h.mgr = mgr
		}

		resp := map[string]any{
			"saved":   true,
			"message": "Configuration saved. Certificate will be obtained in the background.",
		}
		if info := h.mgr.CertInfo(); info != nil {
			resp["certificate"] = info
		}
		pagination.WriteJSON(w, http.StatusOK, resp)
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"saved":   true,
		"message": "TLS configuration saved.",
	})
}

// Test validates DNS provider credentials without saving.
func (h *TLSHandler) Test(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req setTLSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}

	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))

	if req.Provider == "" {
		pagination.WriteError(w, http.StatusBadRequest, "DNS provider is required")
		return
	}
	keys, ok := providerEnvKeys[req.Provider]
	if !ok {
		pagination.WriteError(w, http.StatusBadRequest, "unsupported DNS provider")
		return
	}

	// Check that required credentials are provided
	missing := []string{}
	for _, k := range keys {
		if v, exists := req.Credentials[k]; !exists || v == "" {
			// AWS_HOSTED_ZONE_ID is optional for route53
			if k == "AWS_HOSTED_ZONE_ID" {
				continue
			}
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		pagination.WriteJSON(w, http.StatusOK, map[string]any{
			"valid":   false,
			"message": "Missing credentials: " + strings.Join(missing, ", "),
		})
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"valid":   true,
		"message": "Credentials look valid.",
	})
}

func (h *TLSHandler) loadConfig() tlsConfig {
	var raw string
	if err := h.db.Get(&raw, `SELECT value FROM settings WHERE key = 'tls_config'`); err != nil {
		return tlsConfig{}
	}
	var cfg tlsConfig
	json.Unmarshal([]byte(raw), &cfg)
	return cfg
}
