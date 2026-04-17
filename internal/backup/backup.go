// Package backup creates, encrypts, distributes, and restores BabyTracker
// backup archives. Backups contain a pg_dump of the database plus the full
// photos directory, packaged as a tar.gz file.
//
// Archives can be sent to multiple destinations (see internal/backup/storage),
// each with independent retention and optional AES-256-GCM encryption.
package backup

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/robfig/cron/v3"

	"github.com/mbentancour/babytracker/internal/backup/storage"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/models"
)

// pgEnv translates a PostgreSQL connection URL into the environment
// variables libpq consumes, so we can avoid putting the password on the
// argv of pg_dump / psql. /proc/<pid>/cmdline is world-readable on Linux,
// while /proc/<pid>/environ is restricted to the process's own UID —
// passing credentials via env keeps them out of view of other local users.
func pgEnv(databaseURL string) ([]string, error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return nil, fmt.Errorf("unsupported DATABASE_URL scheme: %s", u.Scheme)
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil {
		host, port = u.Host, "5432"
	}
	env := append(os.Environ(),
		"PGHOST="+host,
		"PGPORT="+port,
		"PGUSER="+u.User.Username(),
		"PGDATABASE="+strings.TrimPrefix(u.Path, "/"),
	)
	if pw, ok := u.User.Password(); ok {
		env = append(env, "PGPASSWORD="+pw)
	}
	if sm := u.Query().Get("sslmode"); sm != "" {
		env = append(env, "PGSSLMODE="+sm)
	}
	return env, nil
}

// DestinationHandle pairs a storage Backend with its configuration — ready
// to receive a backup archive.
type DestinationHandle struct {
	ID         int
	Name       string
	Backend    storage.Backend
	Retention  int
	Passphrase string // empty = no encryption for this destination
}

// UploadResult reports the outcome of distributing a backup to one destination.
type UploadResult struct {
	DestinationID int
	Destination   string
	Filename      string
	Err           error
}

// BuildArchive creates a tar.gz archive in a temp file containing:
//   - database.sql (pg_dump output)
//   - photos/ directory (all uploaded photos)
//
// Returns the path to the temp archive. Caller MUST os.Remove it.
func BuildArchive(databaseURL, dataDir string) (string, error) {
	out, err := os.CreateTemp("", "babytracker-archive-*.tar.gz")
	if err != nil {
		return "", fmt.Errorf("create archive temp: %w", err)
	}
	outPath := out.Name()

	cleanup := func(err error) (string, error) {
		out.Close()
		os.Remove(outPath)
		return "", err
	}

	gz := gzip.NewWriter(out)
	tw := tar.NewWriter(gz)

	// 1. Dump database into the archive.
	if database.IsSQLite() {
		// SQLite: checkpoint the WAL so the .db file is self-contained,
		// then add the file to the archive. Much simpler than pg_dump.
		_, dbPath := database.ParseDatabaseURL(databaseURL)
		if err := sqliteCheckpoint(dbPath); err != nil {
			return cleanup(fmt.Errorf("sqlite wal checkpoint: %w", err))
		}
		if err := addFileToTar(tw, dbPath, "database.sqlite"); err != nil {
			return cleanup(fmt.Errorf("tar database: %w", err))
		}
	} else {
		tmpSQL, err := os.CreateTemp("", "babytracker-dump-*.sql")
		if err != nil {
			return cleanup(fmt.Errorf("temp dump file: %w", err))
		}
		tmpSQLPath := tmpSQL.Name()
		defer os.Remove(tmpSQLPath)

		env, err := pgEnv(databaseURL)
		if err != nil {
			tmpSQL.Close()
			return cleanup(err)
		}
		cmd := exec.Command("pg_dump", "--clean", "--if-exists", "--no-owner", "--no-privileges")
		cmd.Env = env
		cmd.Stdout = tmpSQL
		if err := cmd.Run(); err != nil {
			tmpSQL.Close()
			return cleanup(fmt.Errorf("pg_dump: %w", err))
		}
		tmpSQL.Close()

		if err := addFileToTar(tw, tmpSQLPath, "database.sql"); err != nil {
			return cleanup(fmt.Errorf("tar database: %w", err))
		}
	}

	// 2. Add all photos (skip dirs; non-fatal if individual photos fail).
	photosDir := filepath.Join(dataDir, "photos")
	if info, err := os.Stat(photosDir); err == nil && info.IsDir() {
		entries, _ := os.ReadDir(photosDir)
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			// Skip the thumbnails directory (starts with .)
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			filePath := filepath.Join(photosDir, entry.Name())
			if err := addFileToTar(tw, filePath, "photos/"+entry.Name()); err != nil {
				slog.Warn("skipping photo in backup", "file", entry.Name(), "error", err)
				continue
			}
		}
	}

	if err := tw.Close(); err != nil {
		return cleanup(fmt.Errorf("close tar: %w", err))
	}
	if err := gz.Close(); err != nil {
		return cleanup(fmt.Errorf("close gzip: %w", err))
	}
	if err := out.Close(); err != nil {
		return cleanup(fmt.Errorf("close archive: %w", err))
	}
	return outPath, nil
}

// BackupFilename is the timestamp-based filename for a new backup.
// Encrypted copies get the ".enc" suffix appended.
func BackupFilename(t time.Time) string {
	return "backup_" + t.Format("2006-01-02_150405") + ".tar.gz"
}

// WriteTo pushes the archive at archivePath to each destination. If a
// destination has a Passphrase set, the archive is encrypted before upload
// and saved with a ".enc" filename suffix. Each upload is independent — one
// failing destination doesn't affect the others.
func WriteTo(ctx context.Context, archivePath string, dests []DestinationHandle) []UploadResult {
	now := time.Now()
	baseName := BackupFilename(now)
	results := make([]UploadResult, 0, len(dests))

	for _, d := range dests {
		res := UploadResult{DestinationID: d.ID, Destination: d.Name}

		uploadPath := archivePath
		filename := baseName
		var tmpEnc string

		if d.Passphrase != "" {
			// Encrypt to a destination-specific temp file.
			filename = baseName + ".enc"
			enc, err := os.CreateTemp("", "babytracker-enc-*.tar.gz.enc")
			if err != nil {
				res.Err = fmt.Errorf("create encrypted temp: %w", err)
				results = append(results, res)
				continue
			}
			tmpEnc = enc.Name()

			in, err := os.Open(archivePath)
			if err != nil {
				enc.Close()
				os.Remove(tmpEnc)
				res.Err = fmt.Errorf("open archive: %w", err)
				results = append(results, res)
				continue
			}
			encErr := EncryptStream(enc, in, d.Passphrase)
			in.Close()
			enc.Close()
			if encErr != nil {
				os.Remove(tmpEnc)
				res.Err = fmt.Errorf("encrypt: %w", encErr)
				results = append(results, res)
				continue
			}
			uploadPath = tmpEnc
		}

		// Upload.
		src, err := os.Open(uploadPath)
		if err != nil {
			if tmpEnc != "" {
				os.Remove(tmpEnc)
			}
			res.Err = fmt.Errorf("open for upload: %w", err)
			results = append(results, res)
			continue
		}
		info, _ := src.Stat()
		size := int64(-1)
		if info != nil {
			size = info.Size()
		}
		uErr := d.Backend.Upload(ctx, filename, src, size)
		src.Close()
		if tmpEnc != "" {
			os.Remove(tmpEnc)
		}
		if uErr != nil {
			res.Err = fmt.Errorf("upload: %w", uErr)
			results = append(results, res)
			continue
		}
		res.Filename = filename
		results = append(results, res)

		// Retention: keep the N most recent files in this destination.
		if err := enforceRetention(ctx, d.Backend, d.Retention); err != nil {
			slog.Warn("retention failed", "destination", d.Name, "error", err)
			// Not fatal — the upload already succeeded.
		}
	}
	return results
}

// RunBackup is the full pipeline used by both scheduler and manual endpoint:
// build the archive, distribute to all destinations, remove the local temp.
func RunBackup(ctx context.Context, databaseURL, dataDir string, dests []DestinationHandle) ([]UploadResult, error) {
	if len(dests) == 0 {
		return nil, fmt.Errorf("no destinations to back up to")
	}
	archivePath, err := BuildArchive(databaseURL, dataDir)
	if err != nil {
		return nil, err
	}
	defer os.Remove(archivePath)
	results := WriteTo(ctx, archivePath, dests)

	for _, r := range results {
		if r.Err != nil {
			slog.Error("backup upload failed", "destination", r.Destination, "error", r.Err)
		} else {
			slog.Info("backup uploaded", "destination", r.Destination, "filename", r.Filename)
		}
	}
	return results, nil
}

// ResolveByIDs loads destinations from the DB by ID and pairs them with
// per-destination passphrases from the passphrases map. If a destination is
// configured with encryption:
//   - Use the passphrase from the map if present and non-empty.
//   - Otherwise fall back to a stored passphrase, if one is configured.
//   - Otherwise return an error for that destination — caller reports it.
func ResolveByIDs(db *sqlx.DB, defaultBackupsDir string, allowedRoots []string, ids []int, passphrases map[int]string) ([]DestinationHandle, []error) {
	var handles []DestinationHandle
	var errs []error
	for _, id := range ids {
		d, err := models.GetBackupDestination(db, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("destination %d: %w", id, err))
			continue
		}
		if !d.Enabled {
			errs = append(errs, fmt.Errorf("destination %q is disabled", d.Name))
			continue
		}
		h, err := resolveOne(d, defaultBackupsDir, allowedRoots, passphrases[id])
		if err != nil {
			errs = append(errs, fmt.Errorf("destination %q: %w", d.Name, err))
			continue
		}
		handles = append(handles, h)
	}
	return handles, errs
}

// ResolveForAuto loads all destinations eligible for scheduled backups:
// enabled=true, auto_backup=true, and (if encrypted) has a stored passphrase.
// Destinations that require a passphrase but don't have one stored are skipped
// silently — the UI warns the user at configuration time.
func ResolveForAuto(db *sqlx.DB, defaultBackupsDir string, allowedRoots []string) ([]DestinationHandle, error) {
	dests, err := models.ListBackupDestinations(db)
	if err != nil {
		return nil, err
	}
	var handles []DestinationHandle
	for i := range dests {
		d := &dests[i]
		if !d.Enabled || !d.AutoBackup {
			continue
		}
		cfg, err := d.Config()
		if err != nil {
			slog.Warn("destination config decode failed", "id", d.ID, "error", err)
			continue
		}
		storedPass := ""
		if cfg.Encryption != nil && cfg.Encryption.Passphrase != nil {
			storedPass = *cfg.Encryption.Passphrase
		}
		if cfg.Encryption != nil && storedPass == "" {
			// Encrypted destination without a stored passphrase — skip for
			// scheduled runs.
			slog.Info("skipping encrypted destination without stored passphrase", "name", d.Name)
			continue
		}
		h, err := resolveOne(d, defaultBackupsDir, allowedRoots, storedPass)
		if err != nil {
			slog.Warn("destination resolve failed", "name", d.Name, "error", err)
			continue
		}
		handles = append(handles, h)
	}
	return handles, nil
}

func resolveOne(d *models.BackupDestination, defaultBackupsDir string, allowedRoots []string, providedPassphrase string) (DestinationHandle, error) {
	cfg, err := d.Config()
	if err != nil {
		return DestinationHandle{}, fmt.Errorf("decode config: %w", err)
	}

	backend, err := storage.New(d, defaultBackupsDir, allowedRoots)
	if err != nil {
		return DestinationHandle{}, err
	}

	passphrase := ""
	if cfg.Encryption != nil {
		if providedPassphrase != "" {
			passphrase = providedPassphrase
		} else if cfg.Encryption.Passphrase != nil && *cfg.Encryption.Passphrase != "" {
			passphrase = *cfg.Encryption.Passphrase
		} else {
			return DestinationHandle{}, fmt.Errorf("encrypted destination requires a passphrase")
		}
		// Validate the passphrase against the stored verifier so we fail
		// fast instead of producing undecryptable backups.
		if err := CheckVerifier(passphrase, cfg.Encryption.SaltB64, cfg.Encryption.VerifierB64); err != nil {
			return DestinationHandle{}, fmt.Errorf("passphrase does not match: %w", err)
		}
	}

	return DestinationHandle{
		ID:         d.ID,
		Name:       d.Name,
		Backend:    backend,
		Retention:  d.RetentionCount,
		Passphrase: passphrase,
	}, nil
}

// Restore downloads a backup from the given destination, decrypts it if
// needed, and restores the database + photos.
func Restore(ctx context.Context, dest *models.BackupDestination, filename, passphrase, databaseURL, dataDir, defaultBackupsDir string, allowedRoots []string, wipePhotos bool) error {
	backend, err := storage.New(dest, defaultBackupsDir, allowedRoots)
	if err != nil {
		return err
	}

	src, err := backend.Download(ctx, filename)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer src.Close()

	// If this is an encrypted backup, pipe through the decrypt stream.
	var archiveReader io.Reader = src
	if strings.HasSuffix(filename, ".enc") {
		if passphrase == "" {
			return fmt.Errorf("this backup is encrypted; passphrase required")
		}
		// Decrypt to a temp file first so tar can seek / stream reliably.
		tmp, err := os.CreateTemp("", "babytracker-restore-*.tar.gz")
		if err != nil {
			return fmt.Errorf("create temp: %w", err)
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)

		if err := DecryptStream(tmp, src, passphrase); err != nil {
			tmp.Close()
			return err
		}
		if err := tmp.Close(); err != nil {
			return err
		}
		reopen, err := os.Open(tmpPath)
		if err != nil {
			return err
		}
		defer reopen.Close()
		archiveReader = reopen
	}

	return restoreFromReader(archiveReader, databaseURL, dataDir, wipePhotos)
}

// RestoreFromReader is exported so the HTTP upload endpoint (user drops a
// .tar.gz into the restore form) can re-use the extract logic without going
// through a destination.
func RestoreFromReader(r io.Reader, databaseURL, dataDir string, wipePhotos bool) error {
	return restoreFromReader(r, databaseURL, dataDir, wipePhotos)
}

// RestoreEncryptedFromReader restores an uploaded encrypted archive.
func RestoreEncryptedFromReader(r io.Reader, passphrase, databaseURL, dataDir string, wipePhotos bool) error {
	tmp, err := os.CreateTemp("", "babytracker-restore-*.tar.gz")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := DecryptStream(tmp, r, passphrase); err != nil {
		tmp.Close()
		return err
	}
	tmp.Close()
	f, err := os.Open(tmpPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return restoreFromReader(f, databaseURL, dataDir, wipePhotos)
}

func restoreFromReader(r io.Reader, databaseURL, dataDir string, wipePhotos bool) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("read gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	photosDir := filepath.Join(dataDir, "photos")
	os.MkdirAll(photosDir, 0750)

	// Optional wipe of existing photos so post-backup additions don't linger as
	// orphans. NOT done when the photos directory is shared with other apps
	// (e.g. Home Assistant's media folder configured via MEDIA_PATH) — those
	// callers leave wipePhotos=false. Skip dotfiles (e.g. .thumbnails) which
	// are regenerated lazily.
	if wipePhotos {
		if entries, err := os.ReadDir(photosDir); err == nil {
			for _, e := range entries {
				if strings.HasPrefix(e.Name(), ".") {
					continue
				}
				os.Remove(filepath.Join(photosDir, e.Name()))
			}
		}
	}

	// Always invalidate the thumbnail cache — cached thumbs keyed by basename
	// would otherwise be served for restored photos whose content differs from
	// what was on disk pre-restore. Safe to wipe unconditionally: the `.thumbs`
	// tree is pure cache, regenerated on next request, and lives inside the
	// BabyTracker-owned subdirectory even when PhotosDir is shared media.
	os.RemoveAll(filepath.Join(photosDir, ".thumbs"))

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar entry: %w", err)
		}

		if header.Name == "database.sqlite" {
			// SQLite restore: write the backup file over the current DB.
			// The live connections will see the new data after the next
			// write triggers a WAL rebuild. For safety the caller should
			// restart the process after restore completes.
			_, dbPath := database.ParseDatabaseURL(databaseURL)
			tmpPath := dbPath + ".restoring"
			tmp, err := os.Create(tmpPath)
			if err != nil {
				return fmt.Errorf("create temp restore file: %w", err)
			}
			if _, err := io.Copy(tmp, tr); err != nil {
				tmp.Close()
				os.Remove(tmpPath)
				return fmt.Errorf("write sqlite backup: %w", err)
			}
			tmp.Close()
			// Atomic rename over the live DB file.
			if err := os.Rename(tmpPath, dbPath); err != nil {
				os.Remove(tmpPath)
				return fmt.Errorf("replace database file: %w", err)
			}
			// Remove any leftover WAL/SHM from the old DB.
			os.Remove(dbPath + "-wal")
			os.Remove(dbPath + "-shm")
			slog.Info("sqlite database restored from backup", "path", dbPath)
			// Schedule a process restart so the app picks up the new DB.
			go func() {
				time.Sleep(500 * time.Millisecond)
				slog.Info("restarting after sqlite restore")
				os.Exit(0)
			}()
		} else if header.Name == "database.sql" {
			env, err := pgEnv(databaseURL)
			if err != nil {
				return err
			}
			reset := exec.Command("psql", "-v", "ON_ERROR_STOP=1",
				"-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
			reset.Env = env
			reset.Stderr = os.Stderr
			if err := reset.Run(); err != nil {
				return fmt.Errorf("schema reset: %w", err)
			}
			cmd := exec.Command("psql", "-v", "ON_ERROR_STOP=1", "--single-transaction")
			cmd.Env = env
			cmd.Stdin = filterIncompatibleSQL(tr)
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("database restore: %w", err)
			}
			slog.Info("database restored from backup")
		} else if strings.HasPrefix(header.Name, "photos/") {
			// Reject symlinks, hardlinks, and other non-regular files.
			if header.Typeflag != tar.TypeReg {
				continue
			}
			if header.Size > 20<<20 {
				continue
			}
			photoName := strings.TrimPrefix(header.Name, "photos/")
			if photoName == "" || strings.Contains(photoName, "..") || strings.Contains(photoName, "/") {
				continue
			}
			photoName = filepath.Clean(photoName)
			destPath := filepath.Join(photosDir, photoName)
			absPhotos, _ := filepath.Abs(photosDir)
			absDest, _ := filepath.Abs(destPath)
			if !strings.HasPrefix(absDest, absPhotos) {
				continue
			}
			dest, err := os.Create(destPath)
			if err != nil {
				slog.Warn("failed to restore photo", "file", photoName, "error", err)
				continue
			}
			io.Copy(dest, tr)
			dest.Close()
		}
	}
	return nil
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

// enforceRetention deletes the oldest files beyond the retention limit for
// this backend. Files are sorted by name (which sorts chronologically thanks
// to the timestamped filename scheme).
func enforceRetention(ctx context.Context, backend storage.Backend, keep int) error {
	if keep <= 0 {
		return nil
	}
	objs, err := backend.List(ctx)
	if err != nil {
		return err
	}
	if len(objs) <= keep {
		return nil
	}
	sort.Slice(objs, func(i, j int) bool { return objs[i].Name < objs[j].Name })
	excess := len(objs) - keep
	for i := 0; i < excess; i++ {
		if err := backend.Delete(ctx, objs[i].Name); err != nil {
			slog.Warn("rotation delete failed", "name", objs[i].Name, "error", err)
		} else {
			slog.Info("rotated old backup", "name", objs[i].Name)
		}
	}
	return nil
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

// Scheduler runs per-destination cron schedules. Each destination's schedule
// is evaluated independently: a destination with "0 3 * * *" fires once daily
// at 03:00 server-local, another with "0 * * * *" fires hourly, etc.
// The scheduler rebuilds itself whenever destinations change via Reload.
type Scheduler struct {
	mu                sync.Mutex
	cron              *cron.Cron
	entries           map[int]cron.EntryID // destination ID → cron entry
	db                *sqlx.DB
	databaseURL       string
	dataDir           string
	defaultBackupsDir string
	allowedRoots      []string
}

var globalScheduler *Scheduler

// StartScheduler spins up the cron scheduler and loads destinations from DB.
// Call ReloadScheduler() after any destination create/update/delete to pick
// up the new set of schedules.
func StartScheduler(db *sqlx.DB, databaseURL, dataDir, defaultBackupsDir string, allowedRoots []string) {
	s := &Scheduler{
		cron:              cron.New(), // local timezone, 5-field expressions
		entries:           map[int]cron.EntryID{},
		db:                db,
		databaseURL:       databaseURL,
		dataDir:           dataDir,
		defaultBackupsDir: defaultBackupsDir,
		allowedRoots:      allowedRoots,
	}
	s.cron.Start()
	globalScheduler = s
	if err := s.Reload(); err != nil {
		slog.Error("backup scheduler: initial load failed", "error", err)
	}
	slog.Info("backup scheduler started")
}

// ReloadScheduler rebuilds the set of cron entries from the current DB state.
// Safe to call from HTTP handlers after destination CRUD.
func ReloadScheduler() {
	if globalScheduler == nil {
		return
	}
	if err := globalScheduler.Reload(); err != nil {
		slog.Error("backup scheduler: reload failed", "error", err)
	}
}

func (s *Scheduler) Reload() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dests, err := models.ListBackupDestinations(s.db)
	if err != nil {
		return err
	}

	// Drop all existing entries and rebuild. Simpler than diffing and the
	// destination count is small.
	for _, id := range s.entries {
		s.cron.Remove(id)
	}
	s.entries = map[int]cron.EntryID{}

	for i := range dests {
		d := dests[i] // capture by value
		if !d.Enabled || !d.AutoBackup || strings.TrimSpace(d.Schedule) == "" {
			continue
		}
		destID := d.ID
		id, err := s.cron.AddFunc(d.Schedule, func() { s.runOne(destID) })
		if err != nil {
			slog.Warn("backup scheduler: invalid cron for destination", "id", destID, "name", d.Name, "schedule", d.Schedule, "error", err)
			continue
		}
		s.entries[destID] = id
		slog.Info("backup scheduler: registered", "id", destID, "name", d.Name, "schedule", d.Schedule)
	}
	return nil
}

// runOne executes a backup to a single destination. Each destination has its
// own schedule and retention, so we don't share archive-build work across
// destinations — that would couple their cadences.
func (s *Scheduler) runOne(destID int) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	d, err := models.GetBackupDestination(s.db, destID)
	if err != nil {
		slog.Error("scheduled backup: destination lookup failed", "id", destID, "error", err)
		return
	}
	if !d.Enabled || !d.AutoBackup {
		// Destination was toggled off between Reload() and fire; skip silently.
		return
	}

	cfg, err := d.Config()
	if err != nil {
		slog.Error("scheduled backup: config decode failed", "id", destID, "error", err)
		return
	}
	storedPass := ""
	if cfg.Encryption != nil && cfg.Encryption.Passphrase != nil {
		storedPass = *cfg.Encryption.Passphrase
	}
	if cfg.Encryption != nil && storedPass == "" {
		slog.Info("scheduled backup: skipping encrypted destination without stored passphrase", "name", d.Name)
		return
	}
	h, err := resolveOne(d, s.defaultBackupsDir, s.allowedRoots, storedPass)
	if err != nil {
		slog.Error("scheduled backup: destination resolve failed", "name", d.Name, "error", err)
		return
	}
	if _, err := RunBackup(ctx, s.databaseURL, s.dataDir, []DestinationHandle{h}); err != nil {
		slog.Error("scheduled backup failed", "destination", d.Name, "error", err)
	}
}

// ValidateSchedule returns nil if the given expression is a valid 5-field
// cron, or "" (empty = disabled). Used by handlers before persisting.
func ValidateSchedule(expr string) error {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil
	}
	_, err := cron.ParseStandard(expr)
	return err
}

// incompatibleSetPrefixes lists `SET <param> = ...;` statements that newer
// pg_dump versions emit but older PostgreSQL servers reject. Lines beginning
// with any of these (after trimming whitespace) are dropped before the dump
// is fed to psql, so a version-skew between the dump producer and the server
// doesn't break restore. Match is case-insensitive on the parameter name.
var incompatibleSetPrefixes = []string{
	"SET transaction_timeout",                  // PG 17+
	"SET idle_in_transaction_session_timeout", // PG 9.6+ but absent in some forks
}

// filterIncompatibleSQL wraps an SQL stream and drops lines that set
// parameters the server doesn't recognise. The match is line-prefix only —
// good enough for pg_dump output (which puts each SET on its own line) and
// safe for COPY data (rows never start with "SET ").
func filterIncompatibleSQL(r io.Reader) io.Reader {
	pr, pw := io.Pipe()
	go func() {
		defer pw.Close()
		scanner := bufio.NewScanner(r)
		// Allow long lines: pg_dump can emit huge single-line statements.
		scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for scanner.Scan() {
			line := scanner.Bytes()
			trimmed := strings.TrimLeft(string(line), " \t")
			skip := false
			for _, p := range incompatibleSetPrefixes {
				if strings.HasPrefix(strings.ToUpper(trimmed), strings.ToUpper(p)) {
					skip = true
					break
				}
			}
			if skip {
				continue
			}
			if _, err := pw.Write(line); err != nil {
				return
			}
			if _, err := pw.Write([]byte("\n")); err != nil {
				return
			}
		}
		if err := scanner.Err(); err != nil {
			pw.CloseWithError(err)
		}
	}()
	return pr
}

// sqliteCheckpoint flushes the WAL into the main database file so a file
// copy produces a consistent, self-contained backup. Uses a short-lived
// connection so it doesn't interfere with the app's main pool.
func sqliteCheckpoint(dbPath string) error {
	db, err := sqlx.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
