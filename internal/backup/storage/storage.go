// Package storage defines the backup storage Backend interface and the
// factory that constructs the appropriate implementation from a
// BackupDestination model row.
package storage

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/mbentancour/babytracker/internal/models"
)

// ObjectInfo describes one backup file in a destination's storage.
type ObjectInfo struct {
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// Backend is implemented by each storage provider (local, webdav, ...).
// All operations are blocking and should respect ctx cancellation.
type Backend interface {
	// Upload writes the contents of r to the storage under filename.
	// size is the expected byte length (-1 if unknown); some backends use it
	// for efficient transfer, others ignore it.
	Upload(ctx context.Context, filename string, r io.Reader, size int64) error

	// Download returns a reader for the given file. The caller MUST Close it.
	Download(ctx context.Context, filename string) (io.ReadCloser, error)

	// Delete removes the file. It is not an error if the file is already gone.
	Delete(ctx context.Context, filename string) error

	// List returns all backup archives in this destination, sorted by Name
	// (which sorts chronologically because of our filename scheme).
	List(ctx context.Context) ([]ObjectInfo, error)

	// Test attempts a lightweight round-trip (list or similar) to verify the
	// destination is reachable and authenticated.
	Test(ctx context.Context) error
}

// New builds the Backend that matches dest.Type.
//
// For local destinations, defaultBackupsDir is used when the configured
// path is empty — this preserves pre-existing `{DATA_DIR}/backups` behaviour
// while still allowing users to point at USB/NFS paths. allowedRoots is the
// allow-list a resolved path must be inside of; paths outside are rejected
// to prevent an admin from pointing a destination at arbitrary directories.
func New(dest *models.BackupDestination, defaultBackupsDir string, allowedRoots []string) (Backend, error) {
	cfg, err := dest.Config()
	if err != nil {
		return nil, fmt.Errorf("decode destination config: %w", err)
	}
	switch dest.Type {
	case models.BackupTypeLocal:
		path := cfg.Path
		if path == "" {
			path = defaultBackupsDir
		}
		// Expand relative paths against the default dir so a config value of
		// "usb1" lands at DATA_DIR/backups/usb1 rather than PWD/usb1.
		if !filepath.IsAbs(path) {
			path = filepath.Join(defaultBackupsDir, path)
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return nil, fmt.Errorf("resolve path: %w", err)
		}
		if !pathAllowed(abs, allowedRoots) {
			return nil, fmt.Errorf("path %q is outside the allowed backup roots; set BACKUP_LOCAL_ROOTS to permit additional directories", abs)
		}
		return NewLocal(abs)
	case models.BackupTypeWebDAV:
		return NewWebDAV(cfg.URL, cfg.Username, cfg.Password, cfg.Directory, cfg.TLSMode, cfg.PinnedCertPEM)
	case models.BackupTypeS3:
		return NewS3(S3Options{
			Bucket:          cfg.S3Bucket,
			Region:          cfg.S3Region,
			Prefix:          cfg.S3Prefix,
			AccessKeyID:     cfg.S3AccessKeyID,
			SecretAccessKey: cfg.S3SecretAccessKey,
			EndpointURL:     cfg.S3EndpointURL,
			UsePathStyle:    cfg.S3UsePathStyle,
		})
	default:
		return nil, fmt.Errorf("unsupported backup destination type: %s", dest.Type)
	}
}

// pathAllowed returns true when target is equal to, or a descendant of, any
// root in the allow-list. Symlinks that escape the root tree are not resolved
// here — see the comment on NewLocal for why that's the right tradeoff.
func pathAllowed(target string, roots []string) bool {
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(abs, target)
		if err != nil {
			continue
		}
		if rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)) {
			return true
		}
	}
	return false
}

// IsBackupFilename returns true for filenames matching our backup naming
// convention. Used to skip unrelated files when listing a user-chosen
// local path or a shared WebDAV folder.
func IsBackupFilename(name string) bool {
	base := filepath.Base(name)
	return (len(base) > len("backup_") &&
		base[:len("backup_")] == "backup_") &&
		(hasSuffix(base, ".tar.gz") || hasSuffix(base, ".tar.gz.enc"))
}

func hasSuffix(s, suffix string) bool {
	if len(s) < len(suffix) {
		return false
	}
	return s[len(s)-len(suffix):] == suffix
}
