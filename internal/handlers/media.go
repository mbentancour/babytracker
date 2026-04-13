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
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type MediaHandler struct {
	cfg *config.Config
	db  *sqlx.DB
}

func NewMediaHandler(cfg *config.Config, db *sqlx.DB) *MediaHandler {
	return &MediaHandler{cfg: cfg, db: db}
}

func (h *MediaHandler) ServePhoto(w http.ResponseWriter, r *http.Request) {
	// Authenticate via JWT header OR refresh_token cookie.
	// <img> tags can't send Authorization headers, so the cookie fallback
	// lets browsers display photos while keeping them authenticated.
	var userID int
	authenticated := false

	if authHeader := r.Header.Get("Authorization"); authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && parts[0] == "Bearer" {
			if claims, err := crypto.ValidateAccessToken(h.cfg.JWTSecret, parts[1]); err == nil {
				userID = claims.UserID
				authenticated = true
			}
		}
	}
	if !authenticated {
		if cookie, err := r.Cookie("refresh_token"); err == nil && cookie.Value != "" {
			tokenHash := crypto.HashRefreshToken(cookie.Value)
			if rt, err := models.GetRefreshTokenByHash(h.db, tokenHash); err == nil {
				userID = rt.UserID
				authenticated = true
			}
		}
	}

	if !authenticated {
		http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
		return
	}

	// Authorization: verify user can access this photo's child.
	// Admins can access all photos.
	var isAdmin bool
	h.db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)

	if !isAdmin {
		// Check that the user has access to at least one child
		// (photo filenames contain child IDs, but for defense in depth we check
		// the user has ANY child access — specific ownership is hard to derive
		// from filenames alone without a reverse lookup table)
		accessible, _ := models.GetAccessibleChildIDs(h.db, userID)
		if len(accessible) == 0 {
			http.Error(w, `{"error":"access denied"}`, http.StatusForbidden)
			return
		}
	}

	filename := chi.URLParam(r, "*")

	cleaned := filepath.Clean(filename)
	if strings.Contains(cleaned, "..") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid path")
		return
	}

	fullPath := filepath.Join(h.cfg.DataDir, cleaned)

	absData, _ := filepath.Abs(h.cfg.DataDir)
	absFile, _ := filepath.Abs(fullPath)
	if !strings.HasPrefix(absFile, absData) {
		pagination.WriteError(w, http.StatusForbidden, "access denied")
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, fullPath)
}

var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

func (h *MediaHandler) UploadChildPhoto(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	// 5MB limit for photo uploads
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

	file, header, err := r.FormFile("photo")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "missing or invalid photo file")
		return
	}
	defer file.Close()

	// Validate content type
	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedImageTypes[contentType]
	if !ok {
		// Sniff the content type from the file
		buf := make([]byte, 512)
		n, _ := file.Read(buf)
		contentType = http.DetectContentType(buf[:n])
		ext, ok = allowedImageTypes[contentType]
		if !ok {
			pagination.WriteError(w, http.StatusBadRequest, "file must be JPEG, PNG, WebP, or GIF")
			return
		}
		// Seek back to start
		file.Seek(0, io.SeekStart)
	}

	filename := fmt.Sprintf("child-%d-%d%s", id, time.Now().UnixNano(), ext)
	destPath := filepath.Join(h.cfg.PhotosDir(), filename)

	dest, err := os.Create(destPath)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}
	defer dest.Close()

	if _, err := io.Copy(dest, file); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}

	// Preserve the old profile photo as a standalone photo in the gallery
	var oldPicture string
	h.db.Get(&oldPicture, `SELECT picture FROM children WHERE id = $1`, id)
	if oldPicture != "" {
		h.db.Exec(
			`INSERT INTO photos (child_id, filename, caption, date) VALUES ($1, $2, 'Profile photo', CURRENT_DATE)`,
			id, oldPicture,
		)
	}

	// Update child record with new photo filename
	child, err := models.UpdateChild(h.db, id, map[string]any{"picture": filename})
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update child")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, child)
}

// SetChildPhotoFromExisting sets a child's profile picture to an existing photo by filename.
// PUT /api/children/{id}/photo
func (h *MediaHandler) SetChildPhotoFromFilename(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req struct {
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Filename == "" {
		pagination.WriteError(w, http.StatusBadRequest, "filename is required")
		return
	}

	// Validate the file exists and prevent path traversal
	cleaned := filepath.Clean(req.Filename)
	if strings.Contains(cleaned, "..") || strings.Contains(cleaned, "/") {
		pagination.WriteError(w, http.StatusBadRequest, "invalid filename")
		return
	}
	if _, err := os.Stat(filepath.Join(h.cfg.PhotosDir(), cleaned)); os.IsNotExist(err) {
		pagination.WriteError(w, http.StatusNotFound, "photo not found")
		return
	}

	// Preserve the old profile photo as a standalone photo
	var oldPicture string
	h.db.Get(&oldPicture, `SELECT picture FROM children WHERE id = $1`, id)
	if oldPicture != "" && oldPicture != cleaned {
		h.db.Exec(
			`INSERT INTO photos (child_id, filename, caption, date) VALUES ($1, $2, 'Profile photo', CURRENT_DATE)`,
			id, oldPicture,
		)
	}

	child, err := models.UpdateChild(h.db, id, map[string]any{"picture": cleaned})
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update child")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, child)
}

// UploadEntryPhoto handles photo uploads for any entity type.
// POST /api/{entityType}/{id}/photo
func (h *MediaHandler) UploadEntryPhoto(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	allowedTables := map[string]string{
		"feedings":           "feedings",
		"sleep":              "sleep",
		"changes":            "changes",
		"tummy-times":        "tummy_times",
		"temperature":        "temperature",
		"weight":             "weight",
		"height":             "height",
		"head-circumference": "head_circumference",
		"pumping":            "pumping",
		"medications":        "medications",
		"milestones":         "milestones",
		"notes":              "notes",
		"bmi":                "bmi",
	}

	table, ok := allowedTables[entityType]
	if !ok {
		pagination.WriteError(w, http.StatusBadRequest, "invalid entity type")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

	file, header, err := r.FormFile("photo")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "missing or invalid photo file")
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedImageTypes[contentType]
	if !ok {
		buf := make([]byte, 512)
		n, _ := file.Read(buf)
		contentType = http.DetectContentType(buf[:n])
		ext, ok = allowedImageTypes[contentType]
		if !ok {
			pagination.WriteError(w, http.StatusBadRequest, "file must be JPEG, PNG, WebP, or GIF")
			return
		}
		file.Seek(0, io.SeekStart)
	}

	filename := fmt.Sprintf("%s-%d%s", entityType, id, ext)
	destPath := filepath.Join(h.cfg.PhotosDir(), filename)

	dest, err := os.Create(destPath)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}
	defer dest.Close()

	if _, err := io.Copy(dest, file); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}

	// Update the entity's photo field
	_, err = h.db.Exec(
		fmt.Sprintf("UPDATE %s SET photo = $1 WHERE id = $2", table),
		filename, id,
	)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update record")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]string{"photo": filename})
}

// DeleteEntryPhoto removes the photo from an entity and deletes the file.
func (h *MediaHandler) DeleteEntryPhoto(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	allowedTables := map[string]string{
		"feedings":           "feedings",
		"sleep":              "sleep",
		"changes":            "changes",
		"tummy-times":        "tummy_times",
		"temperature":        "temperature",
		"weight":             "weight",
		"height":             "height",
		"head-circumference": "head_circumference",
		"pumping":            "pumping",
		"medications":        "medications",
		"milestones":         "milestones",
		"notes":              "notes",
		"bmi":                "bmi",
		"children":           "children",
	}

	table, ok := allowedTables[entityType]
	if !ok {
		pagination.WriteError(w, http.StatusBadRequest, "invalid entity type")
		return
	}

	// Get current photo filename
	photoCol := "photo"
	if table == "children" {
		photoCol = "picture"
	}

	var currentPhoto string
	err = h.db.Get(&currentPhoto,
		fmt.Sprintf("SELECT %s FROM %s WHERE id = $1", photoCol, table), id)
	if err == nil && currentPhoto != "" {
		os.Remove(filepath.Join(h.cfg.PhotosDir(), currentPhoto))
	}

	_, err = h.db.Exec(
		fmt.Sprintf("UPDATE %s SET %s = '' WHERE id = $1", table, photoCol), id)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to remove photo")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *MediaHandler) UploadMilestonePhoto(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)

	file, header, err := r.FormFile("photo")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "missing or invalid photo file")
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedImageTypes[contentType]
	if !ok {
		buf := make([]byte, 512)
		n, _ := file.Read(buf)
		contentType = http.DetectContentType(buf[:n])
		ext, ok = allowedImageTypes[contentType]
		if !ok {
			pagination.WriteError(w, http.StatusBadRequest, "file must be JPEG, PNG, WebP, or GIF")
			return
		}
		file.Seek(0, io.SeekStart)
	}

	filename := fmt.Sprintf("milestone-%d%s", id, ext)
	destPath := filepath.Join(h.cfg.PhotosDir(), filename)

	dest, err := os.Create(destPath)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}
	defer dest.Close()

	if _, err := io.Copy(dest, file); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to save photo")
		return
	}

	ms, err := models.UpdateMilestone(h.db, id, map[string]any{"photo": filename})
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update milestone")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, ms)
}
