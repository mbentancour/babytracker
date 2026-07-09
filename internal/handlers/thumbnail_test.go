package handlers

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
)

// serveSizeReq is serveReq with a ?size= query, which lives in the URL rather
// than the chi wildcard param.
func serveSizeReq(t *testing.T, h *MediaHandler, userID int, filename, size string) *httptest.ResponseRecorder {
	t.Helper()
	token, err := crypto.GenerateAccessToken(serveTestSecret, userID, "u", false)
	if err != nil {
		t.Fatal(err)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("*", filename)
	req := httptest.NewRequest(http.MethodGet, "/api/media/"+filename+"?size="+size, nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServePhoto(rec, req)
	return rec
}

// TestServePhotoResizesWithSizeParam exercises the full ?size= path: a real
// JPEG larger than the preset must come back as a smaller, decodable JPEG,
// and the rendition must land in the .thumbs cache.
func TestServePhotoResizesWithSizeParam(t *testing.T) {
	db := setupDB(t)
	dataDir := t.TempDir()
	cfg := &config.Config{DataDir: dataDir, JWTSecret: serveTestSecret}
	photosDir := filepath.Join(dataDir, "photos")
	if err := os.MkdirAll(photosDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := NewMediaHandler(cfg, db, nil)
	admin := mkUser(t, db, "admin", true)

	// A real 3000x2000 JPEG, well above every preset.
	src := image.NewRGBA(image.Rect(0, 0, 3000, 2000))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, src, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(photosDir, "big.jpg"), buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		size    string
		maxEdge int
	}{
		{"thumb", 300},
		{"medium", 800},
		{"large", 1920},
	} {
		t.Run(tc.size, func(t *testing.T) {
			rec := serveSizeReq(t, h, admin, "photos/big.jpg", tc.size)
			if rec.Code != http.StatusOK {
				t.Fatalf("got %d (body: %s)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
				t.Fatalf("content-type = %q, want image/jpeg", ct)
			}
			img, _, err := image.Decode(bytes.NewReader(rec.Body.Bytes()))
			if err != nil {
				t.Fatalf("response is not a decodable image: %v", err)
			}
			b := img.Bounds()
			if b.Dx() != tc.maxEdge {
				t.Fatalf("longest edge = %d, want %d", b.Dx(), tc.maxEdge)
			}
			cached := filepath.Join(photosDir, ".thumbs", tc.size, "big.jpg")
			if _, err := os.Stat(cached); err != nil {
				t.Fatalf("rendition not cached at %s: %v", cached, err)
			}
		})
	}
}
