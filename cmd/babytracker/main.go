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

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// Determine TLS mode for the main server:
	//   1. DNS-01 ACME (managed cert from Let's Encrypt)
	//   2. HTTP-01 ACME (autocert, needs port 443 reachable from internet)
	//   3. Self-signed or manual cert files (TLS_CERT + TLS_KEY)
	//   4. Plain HTTP (no TLS)
	var httpSrv *http.Server // secondary listener (:80 redirect or captive portal)
	var acmeMgr *btacme.Manager

	// DNS-01 ACME: start the background obtain/renew loop. The manager's
	// GetCertificate will serve the ACME cert once available; until then
	// the self-signed fallback below handles TLS.
	if tlsDomain != "" && cfg.ACMEDNSProvider != "" {
		acmeMgr, _ = cfg.ACMEManager.(*btacme.Manager)
		if acmeMgr != nil {
			acmeMgr.Run() // non-blocking: obtains cert in background
		}
	}

	// Build a GetCertificate chain: ACME cert (if available) → self-signed fallback
	if acmeMgr != nil || (tlsDomain != "" && cfg.ACMEDNSProvider == "") {
		// We have some form of managed TLS
		if tlsDomain != "" && cfg.ACMEDNSProvider == "" {
			// HTTP-01 autocert
			os.MkdirAll(cfg.CertsDir, 0700)
			certManager := autocert.Manager{
				Prompt:     autocert.AcceptTOS,
				HostPolicy: autocert.HostWhitelist(tlsDomain),
				Cache:      autocert.DirCache(cfg.CertsDir),
			}
			srv.TLSConfig = &tls.Config{
				GetCertificate: certManager.GetCertificate,
				MinVersion:     tls.VersionTLS12,
			}
			// :80 handles ACME HTTP-01 challenges + redirects
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
		} else if acmeMgr != nil {
			// DNS-01: use ACME manager's GetCertificate with self-signed fallback
			var fallbackCert *tls.Certificate
			if cfg.TLSCert != "" && cfg.TLSKey != "" {
				c, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey)
				if err == nil {
					fallbackCert = &c
				}
			}
			if fallbackCert == nil {
				// No cert files — generate an in-memory self-signed cert
				c, err := btacme.GenerateSelfSignedCert(tlsDomain)
				if err != nil {
					slog.Error("failed to generate self-signed cert", "error", err)
				} else {
					fallbackCert = c
					slog.Info("generated self-signed fallback certificate", "domain", tlsDomain)
				}
			}
			srv.TLSConfig = &tls.Config{
				GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
					if acmeMgr.HasCert() {
						return acmeMgr.TLSConfig().GetCertificate(hello)
					}
					if fallbackCert != nil {
						return fallbackCert, nil
					}
					return nil, fmt.Errorf("no certificate available yet")
				},
				MinVersion: tls.VersionTLS12,
			}
		}
		go func() {
			slog.Info("starting HTTPS server", "port", cfg.Port, "domain", tlsDomain)
			if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()
	} else if cfg.TLSCert != "" && cfg.TLSKey != "" {
		// Self-signed / manual cert only (no ACME configured)
		go func() {
			slog.Info("starting HTTPS server (self-signed)", "port", cfg.Port)
			if err := srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()
	} else {
		// Plain HTTP
		go func() {
			slog.Info("starting HTTP server", "port", cfg.Port)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()
	}

	// Setup mode: captive portal on :80
	if cfg.SetupMode {
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
