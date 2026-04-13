package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/database"
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

	db, err := database.Connect(cfg.DatabaseURL)
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

	r := router.New(db, cfg)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("starting server", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}
