package backup

import (
	"archive/tar"
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

// CreateBackup creates a .tar.gz archive containing:
// - database.sql (pg_dump output)
// - photos/ directory (all uploaded photos)
// Returns the path to the created backup file.
func CreateBackup(databaseURL, dataDir, backupsDir string) (string, error) {
	if err := os.MkdirAll(backupsDir, 0750); err != nil {
		return "", fmt.Errorf("failed to create backups dir: %w", err)
	}

	filename := fmt.Sprintf("backup_%s.tar.gz", time.Now().Format("2006-01-02_150405"))
	path := filepath.Join(backupsDir, filename)

	outFile, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("failed to create backup file: %w", err)
	}
	defer outFile.Close()

	gz := gzip.NewWriter(outFile)
	defer gz.Close()

	tw := tar.NewWriter(gz)
	defer tw.Close()

	// 1. Dump database to a temp file, then add to archive
	tmpSQL, err := os.CreateTemp("", "babytracker-dump-*.sql")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpSQLPath := tmpSQL.Name()
	defer os.Remove(tmpSQLPath)

	cmd := exec.Command("pg_dump", databaseURL)
	cmd.Stdout = tmpSQL
	if err := cmd.Run(); err != nil {
		tmpSQL.Close()
		os.Remove(path)
		return "", fmt.Errorf("pg_dump failed: %w", err)
	}
	tmpSQL.Close()

	if err := addFileToTar(tw, tmpSQLPath, "database.sql"); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("failed to add database dump: %w", err)
	}

	// 2. Add all photos
	photosDir := filepath.Join(dataDir, "photos")
	if info, err := os.Stat(photosDir); err == nil && info.IsDir() {
		entries, _ := os.ReadDir(photosDir)
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			filePath := filepath.Join(photosDir, entry.Name())
			if err := addFileToTar(tw, filePath, "photos/"+entry.Name()); err != nil {
				slog.Warn("skipping photo in backup", "file", entry.Name(), "error", err)
				continue
			}
		}
	}

	slog.Info("backup created", "path", path)
	return path, nil
}

func addFileToTar(tw *tar.Writer, filePath, nameInArchive string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}

	header := &tar.Header{
		Name:    nameInArchive,
		Size:    info.Size(),
		Mode:    0644,
		ModTime: info.ModTime(),
	}

	if err := tw.WriteHeader(header); err != nil {
		return err
	}

	_, err = io.Copy(tw, f)
	return err
}

// RestoreBackup extracts a .tar.gz archive, restores the database, and copies photos.
func RestoreBackup(databaseURL, dataDir, archivePath string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("failed to open backup: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("failed to read gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)

	photosDir := filepath.Join(dataDir, "photos")
	os.MkdirAll(photosDir, 0750)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar entry: %w", err)
		}

		if header.Name == "database.sql" {
			// Restore database
			cmd := exec.Command("psql", databaseURL)
			cmd.Stdin = tr
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("database restore failed: %w", err)
			}
			slog.Info("database restored from backup")
		} else if strings.HasPrefix(header.Name, "photos/") {
			// Extract photo
			photoName := strings.TrimPrefix(header.Name, "photos/")
			if photoName == "" || strings.Contains(photoName, "..") {
				continue
			}
			destPath := filepath.Join(photosDir, photoName)
			dest, err := os.Create(destPath)
			if err != nil {
				slog.Warn("failed to restore photo", "file", photoName, "error", err)
				continue
			}
			io.Copy(dest, tr)
			dest.Close()
		}
	}

	slog.Info("backup restored", "path", archivePath)
	return nil
}

// RotateBackups keeps only the most recent maxBackups files in the directory.
func RotateBackups(backupsDir string) {
	entries, err := os.ReadDir(backupsDir)
	if err != nil {
		return
	}

	var backups []os.DirEntry
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "backup_") && strings.HasSuffix(e.Name(), ".tar.gz") {
			backups = append(backups, e)
		}
	}

	if len(backups) <= maxBackups {
		return
	}

	sort.Slice(backups, func(i, j int) bool {
		return backups[i].Name() < backups[j].Name()
	})

	for i := 0; i < len(backups)-maxBackups; i++ {
		path := filepath.Join(backupsDir, backups[i].Name())
		os.Remove(path)
		slog.Info("rotated old backup", "path", path)
	}
}

// FrequencyToDuration converts a frequency string to a time.Duration.
// Returns 0 for "disabled".
func FrequencyToDuration(freq string) time.Duration {
	switch freq {
	case "6h":
		return 6 * time.Hour
	case "12h":
		return 12 * time.Hour
	case "daily":
		return 24 * time.Hour
	case "weekly":
		return 7 * 24 * time.Hour
	case "disabled", "":
		return 0
	default:
		return 24 * time.Hour
	}
}

// StartScheduler runs backups at the configured frequency.
// Pass "disabled" to skip automatic backups entirely.
func StartScheduler(databaseURL, dataDir, backupsDir, frequency string) {
	interval := FrequencyToDuration(frequency)
	if interval == 0 {
		slog.Info("automatic backups disabled")
		return
	}

	go func() {
		// First backup shortly after start
		time.Sleep(30 * time.Second)
		if _, err := CreateBackup(databaseURL, dataDir, backupsDir); err != nil {
			slog.Error("scheduled backup failed", "error", err)
		} else {
			RotateBackups(backupsDir)
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			if _, err := CreateBackup(databaseURL, dataDir, backupsDir); err != nil {
				slog.Error("scheduled backup failed", "error", err)
			} else {
				RotateBackups(backupsDir)
			}
		}
	}()
	slog.Info("backup scheduler started", "frequency", frequency, "dir", backupsDir)
}
