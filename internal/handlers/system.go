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
	rootUsage, rootStat, rootErr := diskUsage("/")
	if rootErr == nil {
		resp["root"] = rootUsage
	}
	dataUsage, dataStat, dataErr := diskUsage("/var/lib/babytracker")
	// Only return data usage if it's on a different filesystem than root.
	if dataErr == nil && (rootErr != nil || !sameFilesystem(rootStat, dataStat)) {
		resp["data"] = dataUsage
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func diskUsage(path string) (map[string]any, *syscall.Statfs_t, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return nil, nil, err
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used := total - free
	return map[string]any{
		"path":         path,
		"total_bytes":  total,
		"used_bytes":   used,
		"free_bytes":   free,
		"used_percent": percent(used, total),
	}, &stat, nil
}

// sameFilesystem returns true if two Statfs_t describe the same underlying
// filesystem (i.e. paths are mounted from the same source).
func sameFilesystem(a, b *syscall.Statfs_t) bool {
	if a == nil || b == nil {
		return false
	}
	return a.Fsid == b.Fsid
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
