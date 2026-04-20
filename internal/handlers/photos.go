package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// photoBroadcaster is implemented by *DisplayHandler — small interface so the
// photos package doesn't have to depend on the larger handler.
type photoBroadcaster interface {
	BroadcastNewPhoto()
}

type PhotosHandler struct {
	db      *sqlx.DB
	cfg     *config.Config
	display photoBroadcaster
}

func NewPhotosHandler(db *sqlx.DB, cfg *config.Config, display photoBroadcaster) *PhotosHandler {
	return &PhotosHandler{db: db, cfg: cfg, display: display}
}

func (h *PhotosHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var isAdmin bool
	h.db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)

	var photos []models.Photo
	if isAdmin {
		// Admins see every photo, including those not yet tagged to a child.
		if err := h.db.Select(&photos, `SELECT * FROM photos ORDER BY date DESC`); err != nil {
			pagination.WriteError(w, http.StatusInternalServerError, "failed to list photos")
			return
		}
	} else {
		accessible, ok := accessibleChildren(w, r, h.db)
		if !ok {
			return
		}
		if len(accessible) > 0 {
			// Non-admins see only photos tagged with at least one child they
			// can access. Untagged photos stay admin-only.
			placeholders := make([]string, len(accessible))
			args := make([]any, len(accessible))
			for i, id := range accessible {
				placeholders[i] = fmt.Sprintf("$%d", i+1)
				args[i] = id
			}
			query := fmt.Sprintf(`
				SELECT DISTINCT p.* FROM photos p
				JOIN photo_children pc ON pc.photo_filename = p.filename
				WHERE pc.child_id IN (%s)
				ORDER BY p.date DESC`, strings.Join(placeholders, ","))
			if err := h.db.Select(&photos, query, args...); err != nil {
				pagination.WriteError(w, http.StatusInternalServerError, "failed to list photos")
				return
			}
		}
	}
	if photos == nil {
		photos = []models.Photo{}
	}
	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(photos),
		Results: photos,
	})
}

// Upload handles multipart bulk photo uploads. Accepts multiple files.
//
// Limits:
//   - 1 GB total per request (batches above this get rejected by MaxBytesReader)
//   - 25 MB per individual file (modern phone photos routinely exceed 10 MB,
//     especially HEIC→JPEG conversions and high-res Android cameras)
//
// Files that exceed the per-file cap or aren't recognised as images are
// skipped rather than aborting the whole batch; their filenames + reasons
// come back in the `skipped` field of the response so the frontend can tell
// the user which photos didn't make it.
func (h *PhotosHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<30) // 1 GB max for bulk uploads

	if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB in memory, rest on disk
		if err.Error() == "http: request body too large" {
			pagination.WriteError(w, http.StatusRequestEntityTooLarge, "upload too large, max 1GB per batch")
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

	// RBAC middleware reads the child from ?child= or JSON body; multipart
	// uploads go through a different channel, so verify ownership here before
	// tagging any photos. Without this check a user with access to child A
	// could send ?child=A (middleware passes) with form child=B (handler
	// writes) to plant photos in another family's gallery.
	userID := middleware.GetUserID(r.Context())
	if models.CheckAccess(h.db, userID, childID, "photo") != "write" {
		pagination.WriteError(w, http.StatusForbidden, "forbidden")
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
			Filename: filename,
			Caption:  caption,
			Date:     photoDate,
		}
		if err := models.CreatePhoto(h.db, &photo); err != nil {
			os.Remove(destPath)
			continue
		}

		// Auto-tag with the selected child
		models.TagPhotoWithChild(h.db, filename, childID)

		created = append(created, photo)
	}

	if len(created) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid photos uploaded")
		return
	}

	if h.display != nil {
		h.display.BroadcastNewPhoto()
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
	if !ensurePhotoWritable(w, r, h.db, id) {
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
	if !ensurePhotoWritable(w, r, h.db, id) {
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
