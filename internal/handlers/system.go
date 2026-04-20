package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/version"
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

// --- Self-update ---

const githubRepo = "mbentancour/babytracker"

// VersionInfo returns the currently-running version and whether self-update
// is supported in this deployment (Pi/LXC/manual with write access to the
// binary path + systemd restart). Docker/HA/Helm users should use their
// platform's upgrade path instead.
func (h *SystemHandler) VersionInfo(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{
		"current":           version.Version,
		"self_update":       selfUpdateSupported(),
		"self_update_reason": selfUpdateReason(),
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

// UpdateCheck queries the GitHub releases API for the latest release.
func (h *SystemHandler) UpdateCheck(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+githubRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "failed to reach GitHub: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		pagination.WriteError(w, http.StatusBadGateway, fmt.Sprintf("GitHub returned %d", resp.StatusCode))
		return
	}

	var release struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Prerelease  bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "failed to parse GitHub response")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"current":        version.Version,
		"latest":         release.TagName,
		"name":           release.Name,
		"body":           release.Body,
		"url":            release.HTMLURL,
		"published_at":   release.PublishedAt,
		"prerelease":     release.Prerelease,
		"update_available": release.TagName != "" && release.TagName != version.Version,
	})
}

// UpdateApply downloads the release binary for the current arch, verifies its
// SHA256 against the sibling .sha256 file, atomically replaces the running
// binary at /usr/local/bin/babytracker, and restarts the service.
func (h *SystemHandler) UpdateApply(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	if reason := selfUpdateReason(); reason != "" {
		pagination.WriteError(w, http.StatusBadRequest, "self-update not supported here: "+reason)
		return
	}

	var req struct {
		Tag string `json:"tag"` // optional; defaults to latest
	}
	json.NewDecoder(r.Body).Decode(&req) // body is optional

	tag := strings.TrimSpace(req.Tag)
	if tag == "" {
		tag = "latest"
	}

	// Map Go arch names to our release asset naming
	goarch := runtime.GOARCH
	assetName := fmt.Sprintf("babytracker-linux-%s", goarch)

	baseURL := fmt.Sprintf("https://github.com/%s/releases/download/%s", githubRepo, tag)
	if tag == "latest" {
		baseURL = fmt.Sprintf("https://github.com/%s/releases/latest/download", githubRepo)
	}

	slog.Info("self-update: downloading", "tag", tag, "asset", assetName)

	// Download binary + checksum to temp files alongside the target
	targetPath, err := os.Executable()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "cannot locate own binary: "+err.Error())
		return
	}
	targetPath, _ = filepath.EvalSymlinks(targetPath) // resolve to canonical path
	targetDir := filepath.Dir(targetPath)

	tmpBin := filepath.Join(targetDir, ".babytracker.update")
	defer os.Remove(tmpBin)

	if err := downloadFile(baseURL+"/"+assetName, tmpBin); err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "download failed: "+err.Error())
		return
	}
	if err := os.Chmod(tmpBin, 0755); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "chmod failed: "+err.Error())
		return
	}

	// Verify checksum
	expectedHash, err := downloadChecksum(baseURL + "/" + assetName + ".sha256")
	if err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "checksum download failed: "+err.Error())
		return
	}
	actualHash, err := fileSHA256(tmpBin)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "hash failed: "+err.Error())
		return
	}
	if !strings.EqualFold(expectedHash, actualHash) {
		pagination.WriteError(w, http.StatusBadGateway, "checksum mismatch — aborting update")
		return
	}

	// Atomic rename — Linux keeps the running inode alive
	if err := os.Rename(tmpBin, targetPath); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "rename failed: "+err.Error())
		return
	}

	slog.Info("self-update: binary replaced, scheduling restart")

	// Respond before restarting, otherwise the client sees a truncated response
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"message": "Update applied. BabyTracker is restarting — refresh the page in ~5 seconds.",
	})

	// Restart after a short delay so the response flushes
	go func() {
		time.Sleep(500 * time.Millisecond)
		if err := exec.Command("sudo", "systemctl", "restart", "babytracker").Run(); err != nil {
			slog.Error("self-update: restart failed", "error", err)
		}
	}()
}

// selfUpdateSupported returns true when the current process can replace its
// own binary and ask systemd to restart it.
func selfUpdateSupported() bool {
	return selfUpdateReason() == ""
}

// selfUpdateReason returns a human-readable reason why self-update is NOT
// supported, or "" if it is.
func selfUpdateReason() string {
	// Need systemctl present (Pi/LXC/VM, not Docker/HA/k8s)
	if _, err := exec.LookPath("systemctl"); err != nil {
		return "systemd not available — use your platform's upgrade path"
	}
	// Need write access to the binary path
	exe, err := os.Executable()
	if err != nil {
		return "can't locate binary"
	}
	exe, _ = filepath.EvalSymlinks(exe)
	dir := filepath.Dir(exe)
	testFile := filepath.Join(dir, ".babytracker.write-test")
	f, err := os.Create(testFile)
	if err != nil {
		return "binary directory not writable by this user"
	}
	f.Close()
	os.Remove(testFile)
	return ""
}

func downloadFile(url, dest string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func downloadChecksum(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	// sha256sum output: "<hex>  <filename>\n"
	parts := strings.Fields(string(body))
	if len(parts) < 1 {
		return "", fmt.Errorf("empty checksum file")
	}
	return parts[0], nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
