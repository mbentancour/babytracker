package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"encoding/json"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/backup"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type BackupHandler struct {
	cfg *config.Config
	db  *sqlx.DB
}

func NewBackupHandler(cfg *config.Config, db *sqlx.DB) *BackupHandler {
	return &BackupHandler{cfg: cfg, db: db}
}

func (h *BackupHandler) requireAdmin(r *http.Request) bool {
	if isAdmin, ok := r.Context().Value(middleware.IsAdminKey).(bool); ok {
		return isAdmin
	}
	return false
}

// List returns available backups.
func (h *BackupHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	entries, err := os.ReadDir(h.cfg.BackupsDir())
	if err != nil {
		pagination.WriteJSON(w, http.StatusOK, pagination.Response{Count: 0, Results: []any{}})
		return
	}

	type backupInfo struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		Date string `json:"date"`
	}

	var backups []backupInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".tar.gz") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		backups = append(backups, backupInfo{
			Name: e.Name(),
			Size: info.Size(),
			Date: info.ModTime().Format("2006-01-02 15:04:05"),
		})
	}

	// Newest first
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].Name > backups[j].Name
	})

	if backups == nil {
		backups = []backupInfo{}
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(backups),
		Results: backups,
	})
}

// Create triggers an immediate backup.
func (h *BackupHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	path, err := backup.CreateBackup(h.cfg.DatabaseURL, h.cfg.DataDir, h.cfg.BackupsDir())
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "backup failed")
		return
	}
	backup.RotateBackups(h.cfg.BackupsDir())

	info, _ := os.Stat(path)
	pagination.WriteJSON(w, http.StatusCreated, map[string]any{
		"name": filepath.Base(path),
		"size": info.Size(),
	})
}

// Download serves a backup file for download.
func (h *BackupHandler) Download(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name parameter required")
		return
	}

	// Prevent path traversal
	cleaned := filepath.Clean(name)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid name")
		return
	}

	path := filepath.Join(h.cfg.BackupsDir(), cleaned)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		pagination.WriteError(w, http.StatusNotFound, "backup not found")
		return
	}

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, cleaned))
	http.ServeFile(w, r, path)
}

// Restore uploads and restores a backup file.
func (h *BackupHandler) Restore(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 500<<20) // 500MB max

	file, _, err := r.FormFile("backup")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "backup file required")
		return
	}
	defer file.Close()

	// Save to temp file
	tmpFile, err := os.CreateTemp(h.cfg.BackupsDir(), "restore_*.tar.gz")
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create temp file")
		return
	}
	tmpPath := tmpFile.Name()

	if _, err := io.Copy(tmpFile, file); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save upload")
		return
	}
	tmpFile.Close()

	// Restore database + photos
	if err := backup.RestoreBackup(h.cfg.DatabaseURL, h.cfg.DataDir, tmpPath); err != nil {
		os.Remove(tmpPath)
		pagination.WriteError(w, http.StatusInternalServerError, "restore failed")
		return
	}

	os.Remove(tmpPath)
	pagination.WriteJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

// Delete removes a specific backup file.
func (h *BackupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name parameter required")
		return
	}

	cleaned := filepath.Clean(name)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid name")
		return
	}

	path := filepath.Join(h.cfg.BackupsDir(), cleaned)
	if err := os.Remove(path); err != nil {
		pagination.WriteError(w, http.StatusNotFound, "backup not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetSettings returns the current backup frequency.
func (h *BackupHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	freq, err := models.GetSetting(h.db, "backup_frequency")
	if err != nil {
		freq = h.cfg.BackupFrequency
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]string{
		"frequency": freq,
	})
}

// UpdateSettings changes the backup frequency.
// Note: this persists to the DB but the running scheduler won't change until restart.
func (h *BackupHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req struct {
		Frequency string `json:"frequency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	valid := map[string]bool{"disabled": true, "6h": true, "12h": true, "daily": true, "weekly": true}
	if !valid[req.Frequency] {
		pagination.WriteError(w, http.StatusBadRequest, "frequency must be: disabled, 6h, 12h, daily, or weekly")
		return
	}

	if err := models.SetSetting(h.db, "backup_frequency", req.Frequency); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"frequency":       req.Frequency,
		"restart_required": true,
		"message":         "Backup frequency updated. Restart the server for the change to take effect.",
	})
}
