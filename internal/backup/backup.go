package backup

import (
	"compress/gzip"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxBackups = 7

// RunPgDump creates a gzipped pg_dump backup in the backups directory.
// Returns the path to the created backup file.
func RunPgDump(databaseURL, backupsDir string) (string, error) {
	if err := os.MkdirAll(backupsDir, 0750); err != nil {
		return "", fmt.Errorf("failed to create backups dir: %w", err)
	}

	filename := fmt.Sprintf("backup_%s.sql.gz", time.Now().Format("2006-01-02_150405"))
	path := filepath.Join(backupsDir, filename)

	// Run pg_dump and pipe through gzip
	cmd := exec.Command("pg_dump", databaseURL)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start pg_dump: %w", err)
	}

	outFile, err := os.Create(path)
	if err != nil {
		cmd.Wait()
		return "", fmt.Errorf("failed to create backup file: %w", err)
	}

	gz := gzip.NewWriter(outFile)
	gz.Comment = fmt.Sprintf("BabyTracker backup %s", time.Now().Format(time.RFC3339))

	if _, err := io.Copy(gz, stdout); err != nil {
		gz.Close()
		outFile.Close()
		cmd.Wait()
		os.Remove(path)
		return "", fmt.Errorf("failed to write backup: %w", err)
	}

	gz.Close()
	outFile.Close()

	if err := cmd.Wait(); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("pg_dump failed: %w", err)
	}

	slog.Info("backup created", "path", path)
	return path, nil
}

// RotateBackups keeps only the most recent maxBackups files in the directory.
func RotateBackups(backupsDir string) {
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		return
	}

	var backups []os.DirEntry
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "backup_") && strings.HasSuffix(e.Name(), ".sql.gz") {
			backups = append(backups, e)
		}
	}

	if len(backups) <= maxBackups {
		return
	}

	// Sort by name (which includes timestamp) — oldest first
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].Name() < backups[j].Name()
	})

	// Remove oldest
	for i := 0; i < len(backups)-maxBackups; i++ {
		path := filepath.Join(backupsDir, backups[i].Name())
		os.Remove(path)
		slog.Info("rotated old backup", "path", path)
	}
}

// RestoreFromFile restores a database from a gzipped SQL dump.
func RestoreFromFile(databaseURL, filePath string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open backup: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("failed to read gzip: %w", err)
	}
	defer gz.Close()

	cmd := exec.Command("psql", databaseURL)
	cmd.Stdin = gz
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("psql restore failed: %w", err)
	}

	slog.Info("backup restored", "path", filePath)
	return nil
}

// StartScheduler runs daily backups in a background goroutine.
func StartScheduler(databaseURL, backupsDir string) {
	go func() {
		// Run first backup shortly after start
		time.Sleep(30 * time.Second)
		if _, err := RunPgDump(databaseURL, backupsDir); err != nil {
			slog.Error("scheduled backup failed", "error", err)
		} else {
			RotateBackups(backupsDir)
		}

		// Then daily
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if _, err := RunPgDump(databaseURL, backupsDir); err != nil {
				slog.Error("scheduled backup failed", "error", err)
			} else {
				RotateBackups(backupsDir)
			}
		}
	}()
	slog.Info("backup scheduler started", "dir", backupsDir)
}
