package main

import (
	"context"
	"crypto/tls"
	"embed"
	"encoding/json"
	"flag"
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
	flag.StringVar(&cfg.DatabaseURL, "database-url", cfg.DatabaseURL, "PostgreSQL connection URL")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

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

		// Resolve TLS config: env vars take precedence, then DB tls_config, then DB tls_domain
		if cfg.TLSDomain == "" || cfg.ACMEDNSProvider == "" {
			var raw string
			if db.Get(&raw, `SELECT value FROM settings WHERE key = 'tls_config'`) == nil && raw != "" {
				var dbTLS struct {
					Domain      string            `json:"domain"`
					Email       string            `json:"email"`
					Provider    string            `json:"provider"`
					Credentials map[string]string `json:"credentials"`
				}
				if json.Unmarshal([]byte(raw), &dbTLS) == nil {
					if cfg.TLSDomain == "" {
						cfg.TLSDomain = dbTLS.Domain
					}
					if cfg.ACMEDNSProvider == "" && dbTLS.Provider != "" {
						cfg.ACMEDNSProvider = dbTLS.Provider
						cfg.ACMEEmail = dbTLS.Email
						// Set provider credential env vars so lego can read them
						for k, v := range dbTLS.Credentials {
							os.Setenv(k, v)
						}
					}
				}
			}
		}

		// Pre-create ACME manager (if DNS-01 configured) so the TLS handler can use it
		if cfg.TLSDomain != "" && cfg.ACMEDNSProvider != "" {
			mgr, err := btacme.NewManager(btacme.Config{
				Domain:   cfg.TLSDomain,
				Email:    cfg.ACMEEmail,
				Provider: cfg.ACMEDNSProvider,
				CertsDir: cfg.CertsDir,
			})
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
	if tlsDomain == "" && !cfg.IsProxyMode() && !cfg.SetupMode {
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

	// Additional listeners based on mode
	var httpSrv *http.Server
	var autocertSrv *http.Server

	// Determine main server config: when DNS-01 ACME is active, serve on :443
	// with the ACME cert as the primary listener (no separate :8099).
	var acmeMgr *btacme.Manager
	if tlsDomain != "" && cfg.ACMEDNSProvider != "" {
		acmeMgr, _ = cfg.ACMEManager.(*btacme.Manager)
	}

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	if acmeMgr != nil {
		// DNS-01 ACME: serve on :443 with the managed certificate
		if err := acmeMgr.Run(); err != nil {
			slog.Error("failed to obtain certificate via DNS-01", "error", err)
			os.Exit(1)
		}
		srv.Addr = ":443"
		srv.TLSConfig = acmeMgr.TLSConfig()
		go func() {
			slog.Info("starting HTTPS server (DNS-01 cert)", "domain", tlsDomain, "provider", cfg.ACMEDNSProvider, "port", 443)
			if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()

		// HTTP :80 redirects to HTTPS
		httpSrv = &http.Server{
			Addr:              ":80",
			Handler:           http.HandlerFunc(httpToHTTPSRedirect(tlsDomain)),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
		}
		go func() {
			slog.Info("starting HTTP->HTTPS redirect", "port", 80)
			if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Warn("HTTP redirect listener error", "error", err)
			}
		}()
	} else {
		// No ACME: serve on the configured port (default :8099)
		srv.Addr = ":" + cfg.Port
		useTLS := cfg.TLSCert != "" && cfg.TLSKey != ""
		go func() {
			if useTLS {
				slog.Info("starting HTTPS server", "port", cfg.Port)
				if err := srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey); err != nil && err != http.ErrServerClosed {
					slog.Error("server error", "error", err)
					os.Exit(1)
				}
			} else {
				slog.Info("starting HTTP server", "port", cfg.Port)
				if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					slog.Error("server error", "error", err)
					os.Exit(1)
				}
			}
		}()
	}

	if cfg.SetupMode {
		// In setup mode, listen on port 80 for captive portal (HTTP, no redirect)
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
	} else if tlsDomain != "" && acmeMgr == nil {
		// HTTP-01 challenge via autocert — requires port 443 reachable from the internet.
		os.MkdirAll(cfg.CertsDir, 0700)
		certManager := autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(tlsDomain),
			Cache:      autocert.DirCache(cfg.CertsDir),
		}

		autocertSrv = &http.Server{
			Addr:    ":443",
			Handler: handler,
			TLSConfig: &tls.Config{
				GetCertificate: certManager.GetCertificate,
				MinVersion:     tls.VersionTLS12,
			},
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       5 * time.Minute,
			WriteTimeout:      5 * time.Minute,
			IdleTimeout:       120 * time.Second,
		}
		go func() {
			slog.Info("starting Let's Encrypt HTTPS server (HTTP-01)", "domain", tlsDomain, "port", 443)
			if err := autocertSrv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				slog.Error("autocert server error", "error", err)
			}
		}()

		// HTTP :80 handles ACME challenges and redirects everything else to HTTPS
		httpSrv = &http.Server{
			Addr:              ":80",
			Handler:           certManager.HTTPHandler(http.HandlerFunc(httpToHTTPSRedirect(tlsDomain))),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      30 * time.Second,
		}
		go func() {
			slog.Info("starting HTTP->HTTPS redirect + ACME listener", "port", 80)
			if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Warn("HTTP redirect listener error", "error", err)
			}
		}()
	}

	<-ctx.Done()
	slog.Info("shutting down server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if httpSrv != nil {
		httpSrv.Shutdown(shutdownCtx)
	}
	if autocertSrv != nil {
		autocertSrv.Shutdown(shutdownCtx)
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
