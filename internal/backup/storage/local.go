package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

// Local is a filesystem-backed backup storage. Stores files in a directory,
// which may be on an external drive or network mount (NFS/SMB) — the package
// doesn't care, that's the OS's problem.
type Local struct {
	dir string
}

func NewLocal(dir string) (*Local, error) {
	if dir == "" {
		return nil, fmt.Errorf("local backup path is empty")
	}
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, fmt.Errorf("create local backup dir %q: %w", dir, err)
	}
	return &Local{dir: dir}, nil
}

func (l *Local) path(name string) string {
	// Guard against path traversal — filenames must be a single path component.
	return filepath.Join(l.dir, filepath.Base(name))
}

func (l *Local) Upload(ctx context.Context, filename string, r io.Reader, size int64) error {
	tmp, err := os.CreateTemp(l.dir, ".upload-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	// Best-effort cleanup on error.
	defer func() {
		tmp.Close()
		_ = os.Remove(tmpPath)
	}()

	if _, err := io.Copy(tmp, r); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, l.path(filename))
}

func (l *Local) Download(ctx context.Context, filename string) (io.ReadCloser, error) {
	f, err := os.Open(l.path(filename))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("backup %q not found", filename)
		}
		return nil, err
	}
	return f, nil
}

func (l *Local) Delete(ctx context.Context, filename string) error {
	err := os.Remove(l.path(filename))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *Local) List(ctx context.Context) ([]ObjectInfo, error) {
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		return nil, err
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
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ObjectInfo{
			Name:     name,
			Size:     info.Size(),
			Modified: info.ModTime(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (l *Local) Test(ctx context.Context) error {
	// The constructor already ensured the directory exists and is writable
	// enough to create it; re-verify it's still usable.
	info, err := os.Stat(l.dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%q is not a directory", l.dir)
	}
	// Attempt to create and delete a probe file to ensure we can actually write.
	probe := filepath.Join(l.dir, ".babytracker-probe")
	f, err := os.Create(probe)
	if err != nil {
		return fmt.Errorf("write test failed: %w", err)
	}
	f.Close()
	_ = os.Remove(probe)
	return nil
}
