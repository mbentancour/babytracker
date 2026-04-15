package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"

	"github.com/mbentancour/babytracker/internal/backup"
	"github.com/mbentancour/babytracker/internal/backup/storage"
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

func (h *BackupHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if isAdmin, ok := r.Context().Value(middleware.IsAdminKey).(bool); ok && isAdmin {
		return true
	}
	pagination.WriteError(w, http.StatusForbidden, "admin access required")
	return false
}

// SetupRestore accepts a backup file BEFORE any user account exists, restoring
// the schema so the caller can sign in with credentials from the backup.
// Gated by user-count == 0 (same condition as unauthenticated registration),
// so it's not a privilege escalation vector against a running instance.
func (h *BackupHandler) SetupRestore(w http.ResponseWriter, r *http.Request) {
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	if count > 0 {
		pagination.WriteError(w, http.StatusForbidden, "setup restore is only available before the first account is created")
		return
	}

	// Mirror the multipart-upload path of the admin Restore handler, but this
	// endpoint ONLY accepts uploaded files — remote destinations aren't
	// configured at setup time.
	r.Body = http.MaxBytesReader(w, r.Body, 2<<30) // 2 GB cap
	if err := r.ParseMultipartForm(500 << 20); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, header, err := r.FormFile("backup")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "backup file required")
		return
	}
	defer file.Close()

	passphrase := r.FormValue("passphrase")
	wipePhotos := r.FormValue("wipe_photos") == "true"

	encrypted := strings.HasSuffix(header.Filename, ".enc")
	if encrypted && passphrase == "" {
		pagination.WriteError(w, http.StatusBadRequest, "this backup is encrypted; passphrase required")
		return
	}

	if encrypted {
		if err := backup.RestoreEncryptedFromReader(file, passphrase, h.cfg.DatabaseURL, h.cfg.DataDir, wipePhotos); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		if err := backup.RestoreFromReader(file, h.cfg.DatabaseURL, h.cfg.DataDir, wipePhotos); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

// ---------------------------------------------------------------------------
// Backup listing, creation, download, delete, restore
// ---------------------------------------------------------------------------

// backupEntry is what the frontend receives for each distinct backup (grouped
// by filename's base — e.g. "backup_...tar.gz" and ".enc" of the same backup
// are treated as separate entries for clarity).
type backupEntry struct {
	Name         string           `json:"name"`
	Size         int64            `json:"size"`
	Date         string           `json:"date"`
	Encrypted    bool             `json:"encrypted"`
	Destinations []destinationRef `json:"destinations"`
}

type destinationRef struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// List aggregates backups across every configured destination and returns a
// deduped view keyed by filename.
func (h *BackupHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}

	dests, err := models.ListBackupDestinations(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list destinations")
		return
	}

	type key struct {
		Name string
	}
	agg := map[string]*backupEntry{}

	ctx := r.Context()
	for i := range dests {
		d := &dests[i]
		if !d.Enabled {
			continue
		}
		be, err := storage.New(d, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots)
		if err != nil {
			// Skip destinations that can't be constructed; don't fail the list.
			continue
		}
		objs, err := be.List(ctx)
		if err != nil {
			continue
		}
		for _, o := range objs {
			entry, ok := agg[o.Name]
			if !ok {
				entry = &backupEntry{
					Name:      o.Name,
					Size:      o.Size,
					Date:      o.Modified.Format("2006-01-02 15:04:05"),
					Encrypted: strings.HasSuffix(o.Name, ".enc"),
				}
				agg[o.Name] = entry
			}
			entry.Destinations = append(entry.Destinations, destinationRef{
				ID:   d.ID,
				Name: d.Name,
				Type: d.Type,
			})
		}
	}

	out := make([]backupEntry, 0, len(agg))
	for _, v := range agg {
		out = append(out, *v)
	}
	// Newest first (filenames are timestamp-sorted descending).
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(out),
		Results: out,
	})
}

type createRequest struct {
	DestinationIDs []int          `json:"destination_ids"`
	Passphrases    map[int]string `json:"passphrases"`
}

// Create builds one archive and uploads it to every selected destination.
func (h *BackupHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}

	var req createRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body = all enabled destinations

	if req.Passphrases == nil {
		req.Passphrases = map[int]string{}
	}

	// If no IDs specified, target every enabled destination.
	if len(req.DestinationIDs) == 0 {
		all, err := models.ListBackupDestinations(h.db)
		if err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to list destinations")
			return
		}
		for _, d := range all {
			if d.Enabled {
				req.DestinationIDs = append(req.DestinationIDs, d.ID)
			}
		}
	}

	if len(req.DestinationIDs) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no enabled backup destinations configured")
		return
	}

	handles, resolveErrs := backup.ResolveByIDs(h.db, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots, req.DestinationIDs, req.Passphrases)
	if len(handles) == 0 {
		msg := "no usable destinations"
		if len(resolveErrs) > 0 {
			msg = resolveErrs[0].Error()
		}
		pagination.WriteError(w, http.StatusBadRequest, msg)
		return
	}

	// Long-running work — use a generous context.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	results, err := backup.RunBackup(ctx, h.cfg.DatabaseURL, h.cfg.DataDir, handles)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "backup failed: "+err.Error())
		return
	}

	// Return per-destination results, including resolve errors.
	type resultEntry struct {
		DestinationID int    `json:"destination_id"`
		Destination   string `json:"destination"`
		Filename      string `json:"filename,omitempty"`
		Error         string `json:"error,omitempty"`
	}
	out := make([]resultEntry, 0, len(results)+len(resolveErrs))
	for _, r := range results {
		e := resultEntry{
			DestinationID: r.DestinationID,
			Destination:   r.Destination,
			Filename:      r.Filename,
		}
		if r.Err != nil {
			e.Error = r.Err.Error()
		}
		out = append(out, e)
	}
	for _, e := range resolveErrs {
		out = append(out, resultEntry{Error: e.Error()})
	}

	pagination.WriteJSON(w, http.StatusCreated, map[string]any{
		"results": out,
	})
}

// Download streams a backup file from a specific destination.
func (h *BackupHandler) Download(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}

	name := r.URL.Query().Get("name")
	destIDStr := r.URL.Query().Get("destination_id")
	if name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name parameter required")
		return
	}
	if !isSafeBackupName(name) {
		pagination.WriteError(w, http.StatusBadRequest, "invalid name")
		return
	}

	destID, _ := strconv.Atoi(destIDStr)
	if destID == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "destination_id parameter required")
		return
	}

	dest, err := models.GetBackupDestination(h.db, destID)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "destination not found")
		return
	}
	be, err := storage.New(dest, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rc, err := be.Download(r.Context(), name)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "backup not found at destination")
		return
	}
	defer rc.Close()

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	io.Copy(w, rc)
}

// Delete removes a backup file from one destination. If the same filename
// exists on another destination, it remains untouched.
func (h *BackupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	name := r.URL.Query().Get("name")
	destIDStr := r.URL.Query().Get("destination_id")
	if name == "" || destIDStr == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name and destination_id required")
		return
	}
	if !isSafeBackupName(name) {
		pagination.WriteError(w, http.StatusBadRequest, "invalid name")
		return
	}
	destID, _ := strconv.Atoi(destIDStr)
	dest, err := models.GetBackupDestination(h.db, destID)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "destination not found")
		return
	}
	be, err := storage.New(dest, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := be.Delete(r.Context(), name); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Restore handles BOTH: an uploaded file (existing behavior), OR a restore from
// a remote destination when destination_id + name are passed as form values.
// Encrypted backups accept a `passphrase` field.
func (h *BackupHandler) Restore(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	// Parse multipart so we can read both file and other fields.
	if err := r.ParseMultipartForm(500 << 20); err != nil && err != http.ErrNotMultipart {
		// Some clients send JSON — fall back to that below.
	}

	destIDStr := r.FormValue("destination_id")
	name := r.FormValue("name")
	passphrase := r.FormValue("passphrase")
	// wipe_photos: when true, restore deletes any photo files in DataDir/photos
	// not present in the backup. Defaults to false to protect shared media
	// directories (e.g. Home Assistant's MEDIA_PATH).
	wipePhotos := r.FormValue("wipe_photos") == "true"

	// Remote restore path.
	if destIDStr != "" && name != "" {
		if !isSafeBackupName(name) {
			pagination.WriteError(w, http.StatusBadRequest, "invalid name")
			return
		}
		destID, _ := strconv.Atoi(destIDStr)
		dest, err := models.GetBackupDestination(h.db, destID)
		if err != nil {
			pagination.WriteError(w, http.StatusNotFound, "destination not found")
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		if err := backup.Restore(ctx, dest, name, passphrase, h.cfg.DatabaseURL, h.cfg.DataDir, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots, wipePhotos); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		pagination.WriteJSON(w, http.StatusOK, map[string]string{"status": "restored"})
		return
	}

	// Uploaded file path.
	r.Body = http.MaxBytesReader(w, r.Body, 2<<30) // 2 GB max
	file, header, err := r.FormFile("backup")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "backup file required")
		return
	}
	defer file.Close()

	encrypted := strings.HasSuffix(header.Filename, ".enc")
	if encrypted && passphrase == "" {
		pagination.WriteError(w, http.StatusBadRequest, "this backup is encrypted; passphrase required")
		return
	}

	if encrypted {
		if err := backup.RestoreEncryptedFromReader(file, passphrase, h.cfg.DatabaseURL, h.cfg.DataDir, wipePhotos); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		if err := backup.RestoreFromReader(file, h.cfg.DatabaseURL, h.cfg.DataDir, wipePhotos); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func isSafeBackupName(name string) bool {
	if name == "" || strings.Contains(name, "..") || strings.Contains(name, "/") {
		return false
	}
	return strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tar.gz.enc")
}

// ---------------------------------------------------------------------------
// Frequency settings (unchanged behaviour)
// ---------------------------------------------------------------------------

func (h *BackupHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	freq, err := models.GetSetting(h.db, "backup_frequency")
	if err != nil {
		freq = h.cfg.BackupFrequency
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]string{"frequency": freq})
}

func (h *BackupHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
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
		"frequency":        req.Frequency,
		"restart_required": true,
		"message":          "Backup frequency updated. Restart the server for the change to take effect.",
	})
}

// ---------------------------------------------------------------------------
// Destinations CRUD
// ---------------------------------------------------------------------------

// destinationPayload is the body shape for create/update.
// `Config` is a nested object whose fields depend on `Type`.
// Encryption passphrase is only ever written via this endpoint — it is masked
// on GET responses (see models.BackupDestination.PublicConfig).
type destinationPayload struct {
	Name           string         `json:"name"`
	Type           string         `json:"type"`
	Config         map[string]any `json:"config"`
	RetentionCount int            `json:"retention_count"`
	AutoBackup     *bool          `json:"auto_backup"`
	Enabled        *bool          `json:"enabled"`
	// Schedule is a cron expression; "" = no automatic backups.
	// We accept a pointer so PATCH can distinguish "not provided" from "set to empty".
	Schedule *string `json:"schedule"`
	// Encryption setup
	EnableEncryption bool   `json:"enable_encryption"`
	Passphrase       string `json:"passphrase"`         // used to derive key / store verifier
	SavePassphrase   bool   `json:"save_passphrase"`    // when true, store passphrase server-side
	DisableEncryption bool  `json:"disable_encryption"` // PATCH only
}

// serializedDestination is what GET endpoints return — safe config only.
type serializedDestination struct {
	ID             int            `json:"id"`
	Name           string         `json:"name"`
	Type           string         `json:"type"`
	Config         map[string]any `json:"config"`
	RetentionCount int            `json:"retention_count"`
	AutoBackup     bool           `json:"auto_backup"`
	Enabled        bool           `json:"enabled"`
	Schedule       string         `json:"schedule"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

func serializeDestination(d *models.BackupDestination) (serializedDestination, error) {
	pub, err := d.PublicConfig()
	if err != nil {
		return serializedDestination{}, err
	}
	return serializedDestination{
		ID:             d.ID,
		Name:           d.Name,
		Type:           d.Type,
		Config:         pub,
		RetentionCount: d.RetentionCount,
		AutoBackup:     d.AutoBackup,
		Enabled:        d.Enabled,
		Schedule:       d.Schedule,
		CreatedAt:      d.CreatedAt,
		UpdatedAt:      d.UpdatedAt,
	}, nil
}

func (h *BackupHandler) ListDestinations(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	dests, err := models.ListBackupDestinations(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list destinations")
		return
	}
	out := make([]serializedDestination, 0, len(dests))
	for i := range dests {
		s, err := serializeDestination(&dests[i])
		if err != nil {
			continue
		}
		out = append(out, s)
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(out),
		Results: out,
	})
}

func (h *BackupHandler) CreateDestination(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var p destinationPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if p.Name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}
	if p.Type != models.BackupTypeLocal && p.Type != models.BackupTypeWebDAV {
		pagination.WriteError(w, http.StatusBadRequest, "type must be 'local' or 'webdav'")
		return
	}
	if p.RetentionCount <= 0 {
		p.RetentionCount = 7
	}

	cfg, err := buildConfigFromPayload(p.Type, p.Config)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	if p.EnableEncryption {
		if p.Passphrase == "" {
			pagination.WriteError(w, http.StatusBadRequest, "passphrase required to enable encryption")
			return
		}
		salt, verifier, err := backup.MakeVerifier(p.Passphrase)
		if err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "verifier failed")
			return
		}
		enc := &models.EncryptionConfig{SaltB64: salt, VerifierB64: verifier}
		if p.SavePassphrase {
			pass := p.Passphrase
			enc.Passphrase = &pass
		}
		cfg.Encryption = enc
	}

	schedule := "0 3 * * *" // default: daily 3am
	if p.Schedule != nil {
		schedule = strings.TrimSpace(*p.Schedule)
	}
	if err := backup.ValidateSchedule(schedule); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
		return
	}

	d := &models.BackupDestination{
		Name:           p.Name,
		Type:           p.Type,
		RetentionCount: p.RetentionCount,
		AutoBackup:     boolOr(p.AutoBackup, true),
		Enabled:        boolOr(p.Enabled, true),
		Schedule:       schedule,
	}
	if err := d.SetConfig(cfg); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "config encode failed")
		return
	}
	if err := models.CreateBackupDestination(h.db, d); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create destination")
		return
	}
	backup.ReloadScheduler()
	out, _ := serializeDestination(d)
	pagination.WriteJSON(w, http.StatusCreated, out)
}

func (h *BackupHandler) UpdateDestination(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	existing, err := models.GetBackupDestination(h.db, id)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "destination not found")
		return
	}
	var p destinationPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Start from the existing config so we can merge partial updates.
	cfg, err := existing.Config()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "config decode failed")
		return
	}

	if p.Config != nil {
		newCfg, err := buildConfigFromPayload(existing.Type, p.Config)
		if err != nil {
			pagination.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Preserve password field when caller didn't send one (to avoid
		// accidentally clearing it when only updating the URL or directory).
		if existing.Type == models.BackupTypeWebDAV && newCfg.Password == "" {
			newCfg.Password = cfg.Password
		}
		if existing.Type == models.BackupTypeLocal {
			cfg.Path = newCfg.Path
		}
		if existing.Type == models.BackupTypeWebDAV {
			cfg.URL = newCfg.URL
			cfg.Username = newCfg.Username
			cfg.Password = newCfg.Password
			cfg.Directory = newCfg.Directory
			// TLS fields: preserve existing values when the PATCH didn't
			// mention them (tls_mode key absent in payload). buildConfigFromPayload
			// leaves them zero-valued in that case, so we carry the old ones forward.
			if _, sent := p.Config["tls_mode"]; sent {
				cfg.TLSMode = newCfg.TLSMode
				cfg.PinnedCertPEM = newCfg.PinnedCertPEM
			}
		}
	}

	if p.DisableEncryption {
		cfg.Encryption = nil
	} else if p.EnableEncryption {
		if p.Passphrase == "" {
			pagination.WriteError(w, http.StatusBadRequest, "passphrase required to enable encryption")
			return
		}
		salt, verifier, err := backup.MakeVerifier(p.Passphrase)
		if err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "verifier failed")
			return
		}
		enc := &models.EncryptionConfig{SaltB64: salt, VerifierB64: verifier}
		if p.SavePassphrase {
			pass := p.Passphrase
			enc.Passphrase = &pass
		}
		cfg.Encryption = enc
	}

	updates := map[string]any{}
	if p.Name != "" {
		updates["name"] = p.Name
	}
	if p.RetentionCount > 0 {
		updates["retention_count"] = p.RetentionCount
	}
	if p.AutoBackup != nil {
		updates["auto_backup"] = *p.AutoBackup
	}
	if p.Enabled != nil {
		updates["enabled"] = *p.Enabled
	}
	if p.Schedule != nil {
		sched := strings.TrimSpace(*p.Schedule)
		if err := backup.ValidateSchedule(sched); err != nil {
			pagination.WriteError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
			return
		}
		updates["schedule"] = sched
	}
	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "config encode failed")
		return
	}
	updates["config"] = cfgBytes
	updates["updated_at"] = time.Now()

	d, err := models.UpdateBackupDestination(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update destination")
		return
	}
	backup.ReloadScheduler()
	out, _ := serializeDestination(d)
	pagination.WriteJSON(w, http.StatusOK, out)
}

func (h *BackupHandler) DeleteDestination(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteBackupDestination(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete")
		return
	}
	backup.ReloadScheduler()
	w.WriteHeader(http.StatusNoContent)
}

// InspectCert opens a one-shot TLS handshake to the URL in the request body
// and returns the leaf certificate's metadata + PEM. Used by the UI when a
// user adds a WebDAV destination on a LAN server with a self-signed cert —
// they fetch, verify the fingerprint against the server's admin panel, and
// then pin it.
func (h *BackupHandler) InspectCert(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		pagination.WriteError(w, http.StatusBadRequest, "url is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	info, err := storage.FetchServerCert(ctx, req.URL)
	if err != nil {
		pagination.WriteError(w, http.StatusBadGateway, err.Error())
		return
	}
	pagination.WriteJSON(w, http.StatusOK, info)
}

func (h *BackupHandler) TestDestination(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	d, err := models.GetBackupDestination(h.db, id)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "destination not found")
		return
	}
	be, err := storage.New(d, h.cfg.BackupsDir(), h.cfg.BackupLocalRoots)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := be.Test(ctx); err != nil {
		pagination.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func buildConfigFromPayload(destType string, raw map[string]any) (models.BackupDestinationConfig, error) {
	var cfg models.BackupDestinationConfig
	if raw == nil {
		return cfg, nil
	}
	switch destType {
	case models.BackupTypeLocal:
		if v, ok := raw["path"].(string); ok {
			cfg.Path = v
		}
	case models.BackupTypeWebDAV:
		if v, ok := raw["url"].(string); ok {
			cfg.URL = strings.TrimSpace(v)
		}
		if v, ok := raw["username"].(string); ok {
			cfg.Username = v
		}
		if v, ok := raw["password"].(string); ok {
			cfg.Password = v
		}
		if v, ok := raw["directory"].(string); ok {
			cfg.Directory = v
		}
		if cfg.URL == "" {
			return cfg, fmt.Errorf("webdav destinations require a url")
		}
		// TLS verification mode + pinned cert. "strict" is the default and
		// requires no additional fields; "pin" requires a PEM; "skip" has
		// only UX warnings to worry about. We validate here so bad payloads
		// surface before we try to open a connection.
		if v, ok := raw["tls_mode"].(string); ok {
			switch v {
			case "", "strict", "skip":
				cfg.TLSMode = v
			case "pin":
				cfg.TLSMode = v
				pem, _ := raw["pinned_cert_pem"].(string)
				if pem == "" {
					return cfg, fmt.Errorf("tls_mode=pin requires a pinned_cert_pem")
				}
				cfg.PinnedCertPEM = pem
			default:
				return cfg, fmt.Errorf("unknown tls_mode %q (use strict, pin, or skip)", v)
			}
		}
		// Require HTTPS unless the user explicitly opted into skip. Pin
		// doesn't make sense over HTTP either (no cert to pin).
		if !strings.HasPrefix(cfg.URL, "https://") && cfg.TLSMode != "skip" {
			return cfg, fmt.Errorf("plain-HTTP WebDAV requires tls_mode=skip")
		}
	default:
		return cfg, fmt.Errorf("unsupported destination type: %s", destType)
	}
	return cfg, nil
}

func boolOr(v *bool, def bool) bool {
	if v == nil {
		return def
	}
	return *v
}
