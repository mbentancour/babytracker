package config

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Port            string
	DataDir         string
	DatabaseURL     string
	JWTSecret       string
	UnitSystem      string
	RefreshInterval int
	DemoMode        bool
	ProxyURL        string // If set, proxy all requests to this URL (external mode)
	MediaPath       string // Path to scan for external photos (HA media directory)
	TLSCert         string // Path to TLS certificate file (self-signed)
	TLSKey          string // Path to TLS private key file (self-signed)
	TLSDomain       string // Custom domain for Let's Encrypt autocert (empty = disabled)
	CertsDir        string // Directory for autocert certificate cache
	TLSEnabled      bool   // When false, serve plain HTTP (e.g. HA add-on behind ingress proxy)
	ACMEDNSProvider string // DNS provider for DNS-01 challenge (cloudflare, route53, duckdns, namecheap, simply)
	ACMEEmail       string // Email for ACME account registration
	ACMEManageA     bool   // Create/update A record via DNS provider
	ACMEIP          string // IP for the A record (empty = auto-detect)
	SetupMode       bool   // True when .needs-setup flag file exists (Pi first boot)

	// ACMEManager is set at runtime by main.go when the ACME manager is started.
	// Handlers use it to reconfigure TLS and query certificate status.
	ACMEManager any // *acme.Manager (any to avoid import cycle)

	// DisplaySubs holds a handle to the display SSE handler so main.go can
	// close all SSE subscribers at shutdown (prevents the HTTP Shutdown()
	// from blocking on long-lived connections).
	DisplaySubs any // *handlers.DisplayHandler, closer via CloseAll()


	// BackupLocalRoots is the allow-list of filesystem prefixes a Local backup
	// destination's path may resolve into. Defaults to {DataDir}/backups plus
	// any colon-separated value of BACKUP_LOCAL_ROOTS. Prevents an admin from
	// accidentally (or maliciously) pointing a destination at /etc or /var/log.
	BackupLocalRoots []string
}

func (c *Config) IsProxyMode() bool {
	return c.ProxyURL != ""
}

func New() *Config {
	dataDir := envOrDefault("DATA_DIR", "/var/lib/babytracker")

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" || jwtSecret == "change-me-in-production" {
		jwtSecret = loadOrCreateSecret(dataDir)
	}

	databaseURL := envOrDefault("DATABASE_URL", "postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=prefer")
	warnIfInsecureDatabaseURL(databaseURL)

	return &Config{
		Port:            envOrDefault("PORT", "443"),
		DataDir:         dataDir,
		DatabaseURL:     databaseURL,
		JWTSecret:       jwtSecret,
		UnitSystem:      envOrDefault("UNIT_SYSTEM", "metric"),
		RefreshInterval: 30,
		DemoMode:        os.Getenv("DEMO_MODE") == "true",
		ProxyURL:        os.Getenv("BABYTRACKER_PROXY_URL"),
		MediaPath:       os.Getenv("MEDIA_PATH"),
		TLSCert:         os.Getenv("TLS_CERT"),
		TLSKey:          os.Getenv("TLS_KEY"),
		TLSDomain:       os.Getenv("TLS_DOMAIN"),
		CertsDir:        envOrDefault("CERTS_DIR", filepath.Join(dataDir, "certs")),
		TLSEnabled:      os.Getenv("TLS_ENABLED") != "false", // default true
		ACMEDNSProvider: os.Getenv("ACME_DNS_PROVIDER"),
		ACMEEmail:       os.Getenv("ACME_EMAIL"),
		ACMEManageA:     os.Getenv("ACME_MANAGE_A") != "false", // default true
		ACMEIP:          os.Getenv("ACME_IP"),
		SetupMode:       fileExists(filepath.Join(dataDir, ".needs-setup")),
		BackupLocalRoots: parseBackupLocalRoots(dataDir, os.Getenv("BACKUP_LOCAL_ROOTS")),
	}
}

// warnIfInsecureDatabaseURL logs a warning when the DATABASE_URL points at a
// non-loopback host with an sslmode that can fall back to plaintext (disable,
// allow, prefer). Prefer is fine for a sibling docker container on a private
// network but dangerous for a WAN-facing DB — the driver silently downgrades
// when the server doesn't advertise TLS. We don't refuse to start (self-hosted
// admins sometimes know what they're doing), but we want the warning in logs.
func warnIfInsecureDatabaseURL(raw string) {
	u, err := url.Parse(raw)
	if err != nil {
		return
	}
	host := u.Hostname()
	// Unix socket DSNs put the socket path in the `host` query param rather
	// than the URL host — always considered local.
	if host == "" || u.Query().Get("host") != "" {
		return
	}
	mode := strings.ToLower(u.Query().Get("sslmode"))
	if mode != "disable" && mode != "allow" && mode != "prefer" && mode != "" {
		return // require / verify-ca / verify-full
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return
	}
	if host == "localhost" || host == "db" { // common docker-compose service name
		return
	}
	slog.Warn("DATABASE_URL may fall back to plaintext over the network",
		"host", host, "sslmode", mode,
		"hint", "use sslmode=verify-full with a CA bundle for remote databases")
}

// parseBackupLocalRoots returns the allow-list of filesystem roots a Local
// destination may point into. The default backups directory is always
// included; BACKUP_LOCAL_ROOTS (colon-separated) appends extras — typically
// an operator would set it to something like "/mnt/usb:/mnt/nas".
func parseBackupLocalRoots(dataDir, extra string) []string {
	roots := []string{filepath.Join(dataDir, "backups")}
	for _, p := range strings.Split(extra, ":") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		roots = append(roots, p)
	}
	return roots
}

// loadOrCreateSecret reads the JWT secret from a file in the data directory.
// If the file doesn't exist, it generates a new secret and saves it.
// This ensures sessions survive server restarts without requiring an env var.
func loadOrCreateSecret(dataDir string) string {
	secretPath := filepath.Join(dataDir, ".jwt_secret")

	if data, err := os.ReadFile(secretPath); err == nil {
		secret := string(data)
		if len(secret) >= 32 {
			return secret
		}
	}

	// Generate and persist a new secret
	secret := generateRandomSecret()
	os.MkdirAll(dataDir, 0750)
	if err := os.WriteFile(secretPath, []byte(secret), 0600); err != nil {
		slog.Warn("could not persist JWT secret to file, sessions will not survive restart", "error", err)
	} else {
		slog.Info("generated and saved JWT secret", "path", secretPath)
	}
	return secret
}

func generateRandomSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("failed to generate random secret: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func (c *Config) PhotosDir() string {
	// When HA media path is configured, store photos there so they
	// appear in HA's media browser and are included in HA backups.
	if c.MediaPath != "" {
		return c.MediaPath
	}
	return filepath.Join(c.DataDir, "photos")
}

func (c *Config) BackupsDir() string {
	return filepath.Join(c.DataDir, "backups")
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
