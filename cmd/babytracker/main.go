package main

import (
	"context"
	"crypto/tls"
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"os/signal"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/acme/autocert"

	"github.com/mbentancour/babytracker/internal/backup"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/handlers"
	"github.com/mbentancour/babytracker/internal/router"
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

		// Migrate photos from old location to MediaPath if configured
		if cfg.MediaPath != "" {
			oldPhotosDir := filepath.Join(cfg.DataDir, "photos")
			if entries, err := os.ReadDir(oldPhotosDir); err == nil && len(entries) > 0 {
				slog.Info("migrating photos to media path", "from", oldPhotosDir, "to", cfg.MediaPath)
				for _, entry := range entries {
					if entry.IsDir() {
						continue
					}
					oldPath := filepath.Join(oldPhotosDir, entry.Name())
					newPath := filepath.Join(cfg.MediaPath, entry.Name())
					// Don't overwrite if already exists in destination
					if _, err := os.Stat(newPath); err == nil {
						continue
					}
					if err := os.Rename(oldPath, newPath); err != nil {
						// Rename fails across filesystems, fall back to copy+delete
						if data, err := os.ReadFile(oldPath); err == nil {
							if os.WriteFile(newPath, data, 0644) == nil {
								os.Remove(oldPath)
							}
						}
					}
				}
				slog.Info("photo migration complete")
			}
		}

		// Start automatic backup scheduler. Schedules are per-destination
		// (cron expressions on backup_destinations.schedule); the old global
		// backup_frequency setting is ignored by the new scheduler.
		backup.StartScheduler(db, cfg.DatabaseURL, cfg.DataDir, cfg.BackupsDir())

		handler = router.New(db, cfg)
	}

	// Resolve TLS domain: env var takes precedence, then DB setting
	tlsDomain := cfg.TLSDomain
	if tlsDomain == "" && !cfg.IsProxyMode() && !cfg.SetupMode {
		var savedDomain string
		if db != nil {
			if err := db.Get(&savedDomain, `SELECT value FROM settings WHERE key = 'tls_domain'`); err == nil {
				tlsDomain = savedDomain
			}
		}
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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

	// Additional listeners based on mode
	var httpSrv *http.Server
	var autocertSrv *http.Server

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
	} else if tlsDomain != "" {
		// Let's Encrypt autocert on :443 with HTTP-01 challenge on :80
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
			slog.Info("starting Let's Encrypt HTTPS server", "domain", tlsDomain, "port", 443)
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
