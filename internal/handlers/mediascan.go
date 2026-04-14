package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type MediaScanHandler struct {
	cfg *config.Config
}

func NewMediaScanHandler(cfg *config.Config) *MediaScanHandler {
	return &MediaScanHandler{cfg: cfg}
}

type MediaScanItem struct {
	Filename string `json:"filename"`
	Date     string `json:"date"`
}

var scanImageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
}

// List returns all images found in the configured media path.
func (h *MediaScanHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.cfg.MediaPath == "" {
		pagination.WriteJSON(w, http.StatusOK, pagination.Response{Count: 0, Results: []any{}})
		return
	}

	entries, err := os.ReadDir(h.cfg.MediaPath)
	if err != nil {
		pagination.WriteJSON(w, http.StatusOK, pagination.Response{Count: 0, Results: []any{}})
		return
	}

	var items []MediaScanItem
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if !scanImageExts[ext] {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, MediaScanItem{
			Filename: entry.Name(),
			Date:     info.ModTime().Format("2006-01-02"),
		})
	}

	if items == nil {
		items = []MediaScanItem{}
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(items),
		Results: items,
	})
}

// Serve serves a specific image from the media path.
func (h *MediaScanHandler) Serve(w http.ResponseWriter, r *http.Request) {
	if h.cfg.MediaPath == "" {
		http.NotFound(w, r)
		return
	}

	filename := chi.URLParam(r, "filename")

	// Prevent path traversal
	cleaned := filepath.Clean(filename)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		http.NotFound(w, r)
		return
	}

	fullPath := filepath.Join(h.cfg.MediaPath, cleaned)

	// Verify the file is within the media path
	absMedia, _ := filepath.Abs(h.cfg.MediaPath)
	absFile, _ := filepath.Abs(fullPath)
	if !strings.HasPrefix(absFile, absMedia) {
		http.NotFound(w, r)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, fullPath)
}
