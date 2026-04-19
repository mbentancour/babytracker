package handlers

import (
	"net/http"
	"os/exec"
	"syscall"

	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type SystemHandler struct{}

func NewSystemHandler() *SystemHandler {
	return &SystemHandler{}
}

// Storage returns disk usage for the root filesystem and the data directory.
// Sizes are in bytes.
func (h *SystemHandler) Storage(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	resp := map[string]any{}
	if usage, err := diskUsage("/"); err == nil {
		resp["root"] = usage
	}
	if usage, err := diskUsage("/var/lib/babytracker"); err == nil {
		resp["data"] = usage
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func diskUsage(path string) (map[string]any, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return nil, err
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used := total - free
	return map[string]any{
		"path":          path,
		"total_bytes":   total,
		"used_bytes":    used,
		"free_bytes":    free,
		"used_percent":  percent(used, total),
	}, nil
}

func percent(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func (h *SystemHandler) Restart(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{"message": "Restarting..."})

	go func() {
		exec.Command("sudo", "systemctl", "reboot").Run()
	}()
}

func (h *SystemHandler) Shutdown(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{"message": "Shutting down..."})

	go func() {
		exec.Command("sudo", "systemctl", "poweroff").Run()
	}()
}
