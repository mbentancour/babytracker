package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type PhotosHandler struct {
	db  *sqlx.DB
	cfg *config.Config
}

func NewPhotosHandler(db *sqlx.DB, cfg *config.Config) *PhotosHandler {
	return &PhotosHandler{db: db, cfg: cfg}
}

func (h *PhotosHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "photos")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "photos",
		ChildIDField: "child_id",
		DateFields: map[string]string{
			"date_min": "date",
			"date_max": "date",
		},
	}, pp)

	resp, err := pagination.Execute[models.Photo](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list photos")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

// Upload handles multipart bulk photo uploads. Accepts multiple files.
func (h *PhotosHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500<<20) // 500MB max for bulk uploads

	if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB in memory, rest on disk
		if err.Error() == "http: request body too large" {
			pagination.WriteError(w, http.StatusRequestEntityTooLarge, "upload too large, max 500MB")
		} else {
			pagination.WriteError(w, http.StatusBadRequest, "failed to parse upload: "+err.Error())
		}
		return
	}

	childIDStr := r.FormValue("child")
	childID, err := strconv.Atoi(childIDStr)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "child is required")
		return
	}

	caption := r.FormValue("caption")

	files := r.MultipartForm.File["photos"]
	if len(files) == 0 {
		files = r.MultipartForm.File["photo"]
	}
	if len(files) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no files uploaded")
		return
	}

	var created []models.Photo

	for _, fileHeader := range files {
		file, err := fileHeader.Open()
		if err != nil {
			continue
		}

		// Reject individual files over 10MB
		if fileHeader.Size > 10<<20 {
			file.Close()
			continue
		}

		// Validate content type
		buf := make([]byte, 512)
		n, _ := file.Read(buf)
		contentType := http.DetectContentType(buf[:n])
		ext, ok := allowedImageTypes[contentType]
		if !ok {
			file.Close()
			continue
		}
		file.Seek(0, io.SeekStart)

		// Extract date from EXIF metadata, fall back to today
		photoDate := time.Now().Format("2006-01-02")
		exifTime := extractExifDate(file)
		if !exifTime.IsZero() {
			photoDate = exifTime.Format("2006-01-02")
		}

		// Generate unique filename
		filename := fmt.Sprintf("photo-%d-%d%s", childID, time.Now().UnixNano(), ext)
		destPath := filepath.Join(h.cfg.PhotosDir(), filename)

		dest, err := os.Create(destPath)
		if err != nil {
			file.Close()
			continue
		}

		io.Copy(dest, file)
		dest.Close()
		file.Close()

		photo := models.Photo{
			ChildID:  childID,
			Filename: filename,
			Caption:  caption,
			Date:     photoDate,
		}
		if err := models.CreatePhoto(h.db, &photo); err != nil {
			os.Remove(destPath)
			continue
		}

		created = append(created, photo)
	}

	if len(created) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid photos uploaded")
		return
	}

	pagination.WriteJSON(w, http.StatusCreated, map[string]any{
		"uploaded": len(created),
		"photos":   created,
	})
}

func (h *PhotosHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"caption": "caption",
		"date":    "date",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdatePhoto(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update photo")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

func (h *PhotosHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	photo, err := models.GetPhoto(h.db, id)
	if err == nil && photo.Filename != "" {
		os.Remove(filepath.Join(h.cfg.PhotosDir(), photo.Filename))
	}

	if err := models.DeletePhoto(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete photo")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
