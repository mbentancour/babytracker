package storage

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"

	"github.com/studio-b12/gowebdav"
)

// WebDAV is a generic WebDAV-compatible backend. Tested with:
//   - Nextcloud (URL: https://host/remote.php/dav/files/<user>/, with app password)
//   - ownCloud
//   - Synology WebDAV
//   - Infomaniak kDrive
//
// Basic auth is used (username + password). For Nextcloud, users should create
// a device/app password — not their main login password.
type WebDAV struct {
	client *gowebdav.Client
	dir    string
}

// NewWebDAV connects to a WebDAV server. The `dir` is the path inside the
// server where backups are stored (created if missing). Empty dir = root.
//
// tlsMode selects how the TLS handshake validates the server's certificate:
//
//	"" / "strict" — default; validate the chain against system roots.
//	"pin"         — trust ONLY pinnedCertPEM (exact-leaf pinning).
//	"skip"        — no validation at all (LAN / self-signed fallback).
func NewWebDAV(url, username, password, dir, tlsMode, pinnedCertPEM string) (*WebDAV, error) {
	if url == "" {
		return nil, fmt.Errorf("WebDAV URL is empty")
	}
	client := gowebdav.NewClient(url, username, password)

	switch tlsMode {
	case "", "strict":
		// Go's default transport validates — nothing to do.
	case "skip":
		client.SetTransport(&http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		})
	case "pin":
		if pinnedCertPEM == "" {
			return nil, fmt.Errorf("TLS mode 'pin' requires a pinned certificate")
		}
		block, _ := pem.Decode([]byte(pinnedCertPEM))
		if block == nil {
			return nil, fmt.Errorf("pinned certificate is not a valid PEM block")
		}
		pinned, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse pinned cert: %w", err)
		}
		pinnedFP := sha256.Sum256(pinned.Raw)
		client.SetTransport(&http.Transport{
			TLSClientConfig: &tls.Config{
				// InsecureSkipVerify is set so we can do our own check — the
				// custom verifier below replaces the default chain validation
				// with an exact-leaf match against the pinned fingerprint.
				InsecureSkipVerify: true,
				VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
					if len(rawCerts) == 0 {
						return fmt.Errorf("server presented no certificate")
					}
					got := sha256.Sum256(rawCerts[0])
					if subtle.ConstantTimeCompare(got[:], pinnedFP[:]) != 1 {
						return fmt.Errorf("pinned certificate mismatch — the server's certificate does not match the one you trusted for this destination")
					}
					return nil
				},
			},
		})
	default:
		return nil, fmt.Errorf("unknown TLS mode %q", tlsMode)
	}

	w := &WebDAV{client: client, dir: normalizeDir(dir)}
	return w, nil
}

func normalizeDir(d string) string {
	d = strings.Trim(d, "/")
	if d == "" {
		return "/"
	}
	return "/" + d + "/"
}

func (w *WebDAV) joinPath(name string) string {
	return path.Join(w.dir, path.Base(name))
}

// ensureDir creates the backup directory if it doesn't exist. Called lazily
// from Upload so Test/List don't fail on "directory missing" for a just-
// created destination.
func (w *WebDAV) ensureDir(ctx context.Context) error {
	if w.dir == "/" {
		return nil
	}
	// MkdirAll on the full target path (gowebdav handles intermediate dirs).
	return w.client.MkdirAll(w.dir, 0755)
}

func (w *WebDAV) Upload(ctx context.Context, filename string, r io.Reader, size int64) error {
	if err := w.ensureDir(ctx); err != nil {
		return fmt.Errorf("create remote directory: %w", err)
	}
	// gowebdav's WriteStream takes an io.Reader and uploads directly.
	if err := w.client.WriteStream(w.joinPath(filename), r, 0644); err != nil {
		return fmt.Errorf("upload to WebDAV: %w", err)
	}
	return nil
}

func (w *WebDAV) Download(ctx context.Context, filename string) (io.ReadCloser, error) {
	rc, err := w.client.ReadStream(w.joinPath(filename))
	if err != nil {
		return nil, fmt.Errorf("download from WebDAV: %w", err)
	}
	return rc, nil
}

func (w *WebDAV) Delete(ctx context.Context, filename string) error {
	if err := w.client.Remove(w.joinPath(filename)); err != nil {
		// gowebdav returns an error for missing files — swallow that case so
		// idempotent rotation behaves.
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "not found") {
			return nil
		}
		return fmt.Errorf("delete from WebDAV: %w", err)
	}
	return nil
}

func (w *WebDAV) List(ctx context.Context) ([]ObjectInfo, error) {
	entries, err := w.client.ReadDir(w.dir)
	if err != nil {
		// Directory might not exist yet if no backups have been uploaded.
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "not found") {
			return nil, nil
		}
		return nil, fmt.Errorf("list WebDAV directory: %w", err)
	}
	var out []ObjectInfo
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !IsBackupFilename(name) {
			continue
		}
		out = append(out, ObjectInfo{
			Name:     name,
			Size:     e.Size(),
			Modified: e.ModTime(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (w *WebDAV) Test(ctx context.Context) error {
	// Touch base URL — gowebdav's Connect issues an OPTIONS/PROPFIND.
	if err := w.client.Connect(); err != nil {
		return fmt.Errorf("WebDAV connect: %w", err)
	}
	// Directory existence is NOT a failure — we'll create it on first upload.
	return nil
}
