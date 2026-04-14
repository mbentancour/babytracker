package config

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"os"
	"path/filepath"
)

type Config struct {
	Port            string
	DataDir         string
	DatabaseURL     string
	JWTSecret       string
	UnitSystem      string
	RefreshInterval int
	DemoMode        bool
	BackupFrequency string // "disabled", "6h", "12h", "daily", "weekly"
	ProxyURL        string // If set, proxy all requests to this URL (external mode)
	MediaPath       string // Path to scan for external photos (HA media directory)
	TLSCert         string // Path to TLS certificate file (self-signed)
	TLSKey          string // Path to TLS private key file (self-signed)
	TLSDomain       string // Custom domain for Let's Encrypt autocert (empty = disabled)
	CertsDir        string // Directory for autocert certificate cache
	SetupMode       bool   // True when .needs-setup flag file exists (Pi first boot)
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

	return &Config{
		Port:            envOrDefault("PORT", "8099"),
		DataDir:         dataDir,
		DatabaseURL:     envOrDefault("DATABASE_URL", "postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=disable"),
		JWTSecret:       jwtSecret,
		UnitSystem:      envOrDefault("UNIT_SYSTEM", "metric"),
		RefreshInterval: 30,
		DemoMode:        os.Getenv("DEMO_MODE") == "true",
		BackupFrequency: envOrDefault("BACKUP_FREQUENCY", "daily"),
		ProxyURL:        os.Getenv("BABYTRACKER_PROXY_URL"),
		MediaPath:       os.Getenv("MEDIA_PATH"),
		TLSCert:         os.Getenv("TLS_CERT"),
		TLSKey:          os.Getenv("TLS_KEY"),
		TLSDomain:       os.Getenv("TLS_DOMAIN"),
		CertsDir:        envOrDefault("CERTS_DIR", filepath.Join(dataDir, "certs")),
		SetupMode:       fileExists(filepath.Join(dataDir, ".needs-setup")),
	}
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
