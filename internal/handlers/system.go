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
	rootUsage, rootDev, rootErr := diskUsage("/")
	if rootErr == nil {
		resp["root"] = rootUsage
	}
	dataUsage, dataDev, dataErr := diskUsage("/var/lib/babytracker")
	if dataErr == nil && rootErr == nil && !sameVolume(rootUsage, rootDev, dataUsage, dataDev) {
		resp["data"] = dataUsage
	} else if dataErr == nil && rootErr != nil {
		resp["data"] = dataUsage
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

// sameVolume returns true when two paths effectively share storage. We check
// both the device number AND the reported capacity — macOS APFS reports
// different device numbers for the system and data volumes even though they
// share the same APFS container (and thus the same total/used bytes).
func sameVolume(a map[string]any, aDev uint64, b map[string]any, bDev uint64) bool {
	if aDev == bDev {
		return true
	}
	// Fall back to value comparison: same total AND same used means same
	// underlying space (APFS firmlinks, btrfs subvolumes, etc.)
	at, _ := a["total_bytes"].(uint64)
	bt, _ := b["total_bytes"].(uint64)
	au, _ := a["used_bytes"].(uint64)
	bu, _ := b["used_bytes"].(uint64)
	return at == bt && au == bu && at > 0
}

// diskUsage returns disk usage info plus the device number of the path's
// containing filesystem. Two paths with the same device number share the
// same underlying storage even when statfs reports different Fsid values
// (e.g. macOS firmlinks between system and data volumes).
func diskUsage(path string) (map[string]any, uint64, error) {
	var sfs syscall.Statfs_t
	if err := syscall.Statfs(path, &sfs); err != nil {
		return nil, 0, err
	}
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		return nil, 0, err
	}
	total := sfs.Blocks * uint64(sfs.Bsize)
	free := sfs.Bavail * uint64(sfs.Bsize)
	used := total - free
	return map[string]any{
		"path":         path,
		"total_bytes":  total,
		"used_bytes":   used,
		"free_bytes":   free,
		"used_percent": percent(used, total),
	}, uint64(st.Dev), nil
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
