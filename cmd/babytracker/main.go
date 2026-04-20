package main

import (
	"context"
	"crypto/tls"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/acme/autocert"

	btacme "github.com/mbentancour/babytracker/internal/acme"
	"github.com/mbentancour/babytracker/internal/backup"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/handlers"
	"github.com/mbentancour/babytracker/internal/router"
	"github.com/mbentancour/babytracker/internal/webhooks"
)

//go:embed all:migrations
var migrationsFS embed.FS

func main() {
	cfg := config.New()

	flag.StringVar(&cfg.Port, "port", cfg.Port, "Server port")
	flag.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "Data directory for photos and backups")
	// DATABASE_URL is env-var only — CLI flags show up in `ps` and process
	// listing tools, which means any local unprivileged user could read the
	// DB password. Env vars are scoped to the process (and only readable by
	// the owning user on a correctly-permissioned /proc).
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Derive the credential-encryption key from the JWT secret so stored
	// WebDAV/S3/DNS creds are at-rest encrypted. The JWT secret lives on
	// the host filesystem (.jwt_secret) so a leaked DB dump alone is not
	// enough to recover these credentials.
	if err := crypto.InitSecrets(cfg.JWTSecret); err != nil {
		slog.Error("failed to init credential encryption", "error", err)
		os.Exit(1)
	}

	var handler http.Handler
	var db *sqlx.DB

	if cfg.IsProxyMode() {
		// ========================================
		// EXTERNAL MODE: reverse proxy
		// ========================================
		slog.Info("starting in proxy mode", "target", cfg.ProxyURL)

		proxy, err := handlers.NewProxyHandler(cfg.ProxyURL)
		if err != nil {
			slog.Error("failed to create proxy", "error", err)
			os.Exit(1)
		}
		handler = proxy

	} else {
		// ========================================
		// LOCAL MODE: full app with database
		// ========================================
		var err error
		db, err = database.Connect(cfg.DatabaseURL)
		if err != nil {
			slog.Error("failed to connect to database", "error", err)
			os.Exit(1)
		}
		defer db.Close()

		migFS, err := fs.Sub(migrationsFS, "migrations")
		if err != nil {
			slog.Error("failed to access embedded migrations", "error", err)
			os.Exit(1)
		}
		if err := database.RunMigrations(cfg.DatabaseURL, migFS); err != nil {
			slog.Error("failed to run migrations", "error", err)
			os.Exit(1)
		}

		// Ensure data directories exist
		for _, dir := range []string{cfg.PhotosDir(), cfg.BackupsDir()} {
			if err := os.MkdirAll(dir, 0750); err != nil {
				slog.Error("failed to create directory", "dir", dir, "error", err)
				os.Exit(1)
			}
		}

		// Start automatic backup scheduler. Schedules are per-destination
		// via cron expressions on backup_destinations.schedule.
		backup.StartScheduler(db, cfg.DatabaseURL, cfg.DataDir, cfg.BackupsDir(), cfg.BackupLocalRoots)

		// Webhook dispatcher — handlers fire activity events and a
		// background worker delivers them to subscribers (e.g. the HA
		// integration) so push-based updates are possible without polling.
		webhooks.Init(db)

		// Resolve TLS config: env vars take precedence, then DB tls_config, then DB tls_domain.
		// Credentials from DB flow straight into acmeCfg below — we don't stamp them
		// into the process env, so a local unprivileged user can't read them from
		// /proc/<pid>/environ and child processes don't inherit them.
		var dbCredentials map[string]string
		if cfg.TLSDomain == "" || cfg.ACMEDNSProvider == "" {
			var raw string
			if db.Get(&raw, `SELECT value FROM settings WHERE key = 'tls_config'`) == nil && raw != "" {
				var dbTLS struct {
					Domain      string            `json:"domain"`
					Email       string            `json:"email"`
					Provider    string            `json:"provider"`
					Credentials map[string]string `json:"credentials"`
					ManageA     *bool             `json:"manage_a,omitempty"`
					IP          string            `json:"ip,omitempty"`
				}
				if json.Unmarshal([]byte(raw), &dbTLS) == nil {
					if cfg.TLSDomain == "" {
						cfg.TLSDomain = dbTLS.Domain
					}
					if cfg.ACMEDNSProvider == "" && dbTLS.Provider != "" {
						cfg.ACMEDNSProvider = dbTLS.Provider
						cfg.ACMEEmail = dbTLS.Email
						if dbTLS.ManageA != nil {
							cfg.ACMEManageA = *dbTLS.ManageA
						}
						if dbTLS.IP != "" {
							cfg.ACMEIP = dbTLS.IP
						}
						// Decrypt the envelope-wrapped credentials so lego
						// sees plaintext. Legacy rows pass through.
						dbCredentials = crypto.DecryptMap(dbTLS.Credentials)
					}
				}
			}
		}

		// Always create an ACME manager so the TLS handler and Settings UI
		// can configure/reconfigure it at runtime. If DNS-01 config exists,
		// it will start obtaining a cert in the background.
		acmeCfg := btacme.Config{
			Domain:      cfg.TLSDomain,
			Email:       cfg.ACMEEmail,
			Provider:    cfg.ACMEDNSProvider,
			CertsDir:    cfg.CertsDir,
			ManageA:     cfg.ACMEManageA,
			IP:          cfg.ACMEIP,
			Credentials: dbCredentials,
		}
		if acmeCfg.Domain != "" && acmeCfg.Provider != "" {
			mgr, err := btacme.NewManager(acmeCfg)
			if err != nil {
				slog.Error("failed to create ACME manager", "error", err)
			} else {
				cfg.ACMEManager = mgr
			}
		}

		handler = router.New(db, cfg)
	}

	// Resolve TLS domain: cfg.TLSDomain may have been set from DB above
	tlsDomain := cfg.TLSDomain
	if tlsDomain == "" && !cfg.IsProxyMode() && !cfg.IsSetupMode() {
		var savedDomain string
		if db != nil {
			if err := db.Get(&savedDomain, `SELECT value FROM settings WHERE key = 'tls_domain'`); err == nil {
				tlsDomain = savedDomain
			}
		}
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	var httpSrv *http.Server

	if !cfg.TLSEnabled {
		// Plain HTTP mode (e.g. HA add-on behind ingress proxy)
		go func() {
			slog.Info("starting HTTP server (TLS disabled)", "port", cfg.Port)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()
	} else {

	acmeMgr, _ := cfg.ACMEManager.(*btacme.Manager)

	// Start ACME background loop if configured
	if acmeMgr != nil {
		acmeMgr.Run() // non-blocking
	}

	// Build the self-signed fallback certificate (used until ACME succeeds,
	// or permanently if ACME is never configured).
	var fallbackCert *tls.Certificate
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		c, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
		if err == nil {
			fallbackCert = &c
		}
	}
	if fallbackCert == nil {
		// Try loading a previously generated self-signed cert from disk
		certPath := cfg.CertsDir + "/self-signed.crt"
		keyPath := cfg.CertsDir + "/self-signed.key"
		c, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err == nil {
			fallbackCert = &c
			slog.Info("loaded self-signed certificate from disk")
		} else {
			// Generate and persist a new one
			domain := tlsDomain
			if domain == "" {
				domain = "babytracker.local"
			}
			gen, err := btacme.GenerateSelfSignedCert(domain)
			if err != nil {
				slog.Error("failed to generate self-signed cert", "error", err)
			} else {
				fallbackCert = gen
				// Persist to disk for next restart
				os.MkdirAll(cfg.CertsDir, 0700)
				btacme.SaveCertToFiles(gen, certPath, keyPath)
				slog.Info("generated and saved self-signed certificate", "domain", domain)
			}
		}
	}

	// Always serve HTTPS. GetCertificate checks ACME first, then falls back
	// to self-signed. This means ACME can be configured later via Settings
	// and the cert will be picked up without a restart.
	srv.TLSConfig = &tls.Config{
		GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
			// 1. ACME cert (if manager exists and has obtained one)
			if acmeMgr != nil && acmeMgr.HasCert() {
				return acmeMgr.TLSConfig().GetCertificate(hello)
			}
			// 2. Self-signed fallback
			if fallbackCert != nil {
				return fallbackCert, nil
			}
			return nil, fmt.Errorf("no certificate available")
		},
		MinVersion: tls.VersionTLS12,
	}
	go func() {
		slog.Info("starting HTTPS server", "port", cfg.Port)
		if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// HTTP-01 autocert listener (only if TLS_DOMAIN is set without DNS provider)
	if tlsDomain != "" && cfg.ACMEDNSProvider == "" {
		os.MkdirAll(cfg.CertsDir, 0700)
		certManager := autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(tlsDomain),
			Cache:      autocert.DirCache(cfg.CertsDir),
		}
		httpSrv = &http.Server{
			Addr:              ":80",
			Handler:           certManager.HTTPHandler(http.HandlerFunc(httpToHTTPSRedirect(tlsDomain))),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
		}
		go func() {
			slog.Info("starting HTTP-01 challenge + redirect listener", "port", 80)
			if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Warn("HTTP listener error", "error", err)
			}
		}()
	}

	} // end TLS enabled

	// Setup mode: captive portal on :80
	if cfg.IsSetupMode() {
		httpSrv = &http.Server{
			Addr:              ":80",
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
		}
		go func() {
			slog.Info("starting HTTP captive portal listener", "port", 80)
			if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Warn("captive portal listener error", "error", err)
			}
		}()
	}

	<-ctx.Done()
	slog.Info("shutting down server")

	// Close long-lived SSE subscribers first so their handlers return and
	// don't hold http.Server.Shutdown() past its deadline.
	if closer, ok := cfg.DisplaySubs.(interface{ CloseAll() }); ok {
		closer.CloseAll()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if httpSrv != nil {
		httpSrv.Shutdown(shutdownCtx)
	}
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}

func httpToHTTPSRedirect(domain string) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		target := "https://" + domain + r.URL.RequestURI()
		http.Redirect(w, r, target, http.StatusMovedPermanently)
	}
}
