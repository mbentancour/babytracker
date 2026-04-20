package handlers

import (
	"context"
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
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/version"
)

// updateTagRe matches valid release tags: "v1.2.3", "v1.2.3-beta1", or "latest".
// The self-update flow interpolates the tag into a GitHub download URL and a
// filesystem path; restricting the charset shuts the door on path traversal
// and URL injection via an attacker-controlled tag body.
var updateTagRe = regexp.MustCompile(`^(v\d+\.\d+\.\d+(-[a-z0-9.]+)?|latest)$`)

// maxUpdateBytes caps the self-update binary download. Current release assets
// are ~40–60 MB; 500 MB leaves ample headroom while preventing a hostile
// mirror from streaming an infinite body at us.
const maxUpdateBytes = 500 * 1024 * 1024

// semver splits a "vX.Y.Z[-pre]" tag into its integer components for ordering.
// Pre-release suffixes are ignored for the comparison — they order equal to the
// base version, which is intentional: we only want to block downgrades across
// release numbers, not block a 1.2.3 -> 1.2.3-rc1 transition on dev builds.
var semverRe = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)`)

func parseSemver(tag string) (maj, min, patch int, ok bool) {
	m := semverRe.FindStringSubmatch(tag)
	if m == nil {
		return 0, 0, 0, false
	}
	fmt.Sscanf(m[1]+" "+m[2]+" "+m[3], "%d %d %d", &maj, &min, &patch)
	return maj, min, patch, true
}

// isDowngrade returns true when `target` is strictly older than `current`.
// Returns false if either version can't be parsed (dev builds, "latest") so
// non-release developer flows aren't blocked.
func isDowngrade(current, target string) bool {
	cm, cn, cp, ok1 := parseSemver(current)
	tm, tn, tp, ok2 := parseSemver(target)
	if !ok1 || !ok2 {
		return false
	}
	if tm != cm {
		return tm < cm
	}
	if tn != cn {
		return tn < cn
	}
	return tp < cp
}

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
		Tag             string `json:"tag"`              // optional; defaults to latest
		ForceDowngrade  bool   `json:"force_downgrade"`  // opt-in for older tags
	}
	json.NewDecoder(r.Body).Decode(&req) // body is optional

	tag := strings.TrimSpace(req.Tag)
	if tag == "" {
		tag = "latest"
	}
	if !updateTagRe.MatchString(tag) {
		pagination.WriteError(w, http.StatusBadRequest, "invalid tag format")
		return
	}

	// Block silent downgrades. An attacker who gained admin access could use
	// the update flow to pin a known-vulnerable older release; require an
	// explicit opt-in so the path is auditable in logs.
	if tag != "latest" && !req.ForceDowngrade && isDowngrade(version.Version, tag) {
		pagination.WriteError(w, http.StatusBadRequest, "target tag is older than current version; pass force_downgrade=true to proceed")
		return
	}

	// Map Go arch names to our release asset naming
	goarch := runtime.GOARCH
	assetName := fmt.Sprintf("babytracker-linux-%s", goarch)

	baseURL := fmt.Sprintf("https://github.com/%s/releases/download/%s", githubRepo, tag)
	if tag == "latest" {
		baseURL = fmt.Sprintf("https://github.com/%s/releases/latest/download", githubRepo)
	}

	slog.Info("self-update: downloading", "tag", tag, "asset", assetName)

	// Resolve the running binary's canonical path. The replacement rename
	// has to target this exact inode so systemd picks up the new bits on
	// restart.
	targetPath, err := os.Executable()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "cannot locate own binary")
		slog.Error("self-update: os.Executable failed", "error", err)
		return
	}
	targetPath, _ = filepath.EvalSymlinks(targetPath)
	targetDir := filepath.Dir(targetPath)

	// Scratch directory with 0700 so a local unprivileged user can't peek at
	// the in-flight binary or swap it before we rename. MkdirTemp generates
	// a random suffix so a predictable-path race is not possible.
	tmpDir, err := os.MkdirTemp(targetDir, ".bt-update-")
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create temp dir")
		slog.Error("self-update: MkdirTemp failed", "error", err)
		return
	}
	defer os.RemoveAll(tmpDir)
	if err := os.Chmod(tmpDir, 0700); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to secure temp dir")
		slog.Error("self-update: chmod temp dir failed", "error", err)
		return
	}
	tmpBin := filepath.Join(tmpDir, "babytracker.new")

	if err := downloadFile(baseURL+"/"+assetName, tmpBin, maxUpdateBytes); err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "download failed")
		slog.Error("self-update: download failed", "error", err)
		return
	}
	if err := os.Chmod(tmpBin, 0755); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "chmod failed")
		slog.Error("self-update: chmod binary failed", "error", err)
		return
	}

	// Verify checksum
	expectedHash, err := downloadChecksum(baseURL + "/" + assetName + ".sha256")
	if err != nil {
		pagination.WriteError(w, http.StatusBadGateway, "checksum download failed")
		slog.Error("self-update: checksum download failed", "error", err)
		return
	}
	actualHash, err := fileSHA256(tmpBin)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "hash failed")
		slog.Error("self-update: hash failed", "error", err)
		return
	}
	if !strings.EqualFold(expectedHash, actualHash) {
		pagination.WriteError(w, http.StatusBadGateway, "checksum mismatch — aborting update")
		return
	}

	// Stage the currently-running binary to a .prev path so we can restore it
	// if systemctl restart fails (see the watchdog goroutine below). A hard
	// link is cheap and atomic; if linking fails (cross-fs or noexec-tmp),
	// fall through to a copy.
	prevBin := filepath.Join(targetDir, ".babytracker.prev")
	os.Remove(prevBin)
	if err := os.Link(targetPath, prevBin); err != nil {
		if copyErr := copyBinaryForRollback(targetPath, prevBin); copyErr != nil {
			slog.Warn("self-update: could not stage rollback copy", "error", copyErr)
			// proceed anyway — rollback is best-effort
		}
	}

	// Atomic rename — Linux keeps the running inode alive.
	if err := os.Rename(tmpBin, targetPath); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "rename failed")
		slog.Error("self-update: rename failed", "error", err)
		return
	}

	slog.Info("self-update: binary replaced, scheduling restart")

	// Respond before restarting, otherwise the client sees a truncated response
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"message": "Update applied. BabyTracker is restarting — refresh the page in ~5 seconds.",
	})

	// Restart after a short delay so the response flushes. The watchdog
	// below gives the new binary 30s to come up healthy; if the restart
	// command itself fails, roll the old binary back into place so the
	// operator isn't left with a broken box.
	go func() {
		time.Sleep(500 * time.Millisecond)
		if err := exec.Command("sudo", "systemctl", "restart", "babytracker").Run(); err != nil {
			slog.Error("self-update: restart failed, rolling back", "error", err)
			if _, statErr := os.Stat(prevBin); statErr == nil {
				if rbErr := os.Rename(prevBin, targetPath); rbErr != nil {
					slog.Error("self-update: rollback rename failed", "error", rbErr)
				} else {
					slog.Info("self-update: rolled back to previous binary")
					// Try the restart once more with the old binary
					exec.Command("sudo", "systemctl", "restart", "babytracker").Run()
				}
			}
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

// downloadFile streams url into dest with an overall deadline and a hard
// byte cap. The context timeout covers the whole transfer (handshake +
// body), and io.LimitReader aborts if a hostile mirror tries to stream
// more than maxBytes — either failure mode leaves a truncated file that
// the subsequent SHA256 check will reject.
func downloadFile(url, dest string, maxBytes int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxBytes {
		return fmt.Errorf("asset too large: %d bytes (max %d)", resp.ContentLength, maxBytes)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(f, io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return err
	}
	if n > maxBytes {
		return fmt.Errorf("asset exceeded %d byte cap", maxBytes)
	}
	return nil
}

// copyBinaryForRollback is the fallback path when os.Link can't stage the
// rollback copy (e.g. cross-filesystem or noexec /tmp). Only used for the
// .prev snapshot, so performance doesn't matter.
func copyBinaryForRollback(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
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
