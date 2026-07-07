package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
)

const serveTestSecret = "serve-photo-test-secret-0123456789"

// serveReq drives ServePhoto for a wildcard filename as the given user,
// mirroring how the router mounts it (chi URL param "*").
func serveReq(t *testing.T, h *MediaHandler, userID int, filename string) *httptest.ResponseRecorder {
	t.Helper()
	token, err := crypto.GenerateAccessToken(serveTestSecret, userID, "u", false)
	if err != nil {
		t.Fatal(err)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("*", filename)
	req := httptest.NewRequest(http.MethodGet, "/api/media/"+filename, nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServePhoto(rec, req)
	return rec
}

// TestServePhotoOwnership is the regression guard for the photo IDOR fix: a
// caregiver may fetch only photos belonging to children they can access;
// admins see all; untracked/shared files stay visible to any authenticated
// user with child access.
func TestServePhotoOwnership(t *testing.T) {
	db := setupDB(t)

	photosDir := t.TempDir()
	cfg := &config.Config{DataDir: photosDir, JWTSecret: serveTestSecret}
	// PhotosDir() = DataDir/photos; create it and drop the test files there.
	realDir := filepath.Join(photosDir, "photos")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := NewMediaHandler(cfg, db, nil)

	// Fixtures: two children, a caregiver who can only reach child A, an admin.
	childA := mkChild(t, db, "Aria")
	childB := mkChild(t, db, "Bo")
	role := mkRole(t, db, "caregiver")
	caregiver := mkUser(t, db, "caregiver", false)
	grantChild(t, db, caregiver, childA, role)
	admin := mkUser(t, db, "admin", true)

	// child B has a feeding photo; child A has one; plus an untracked "shared" file.
	photoA := "feedings-100.jpg"
	photoB := "feedings-200.jpg"
	shared := "orphan-file.jpg"
	mkFeedingPhoto(t, db, childA, photoA)
	mkFeedingPhoto(t, db, childB, photoB)
	for _, name := range []string{photoA, photoB, shared} {
		if err := os.WriteFile(filepath.Join(realDir, name), []byte("\xff\xd8\xff jpeg-ish"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name   string
		userID int
		file   string
		want   int
	}{
		{"caregiver blocked from other child's photo (IDOR)", caregiver, photoB, http.StatusForbidden},
		{"caregiver allowed own child's photo", caregiver, photoA, http.StatusOK},
		{"admin allowed any photo", admin, photoB, http.StatusOK},
		{"untracked shared photo visible to caregiver", caregiver, shared, http.StatusOK},
		{"missing file is 404", caregiver, "feedings-999.jpg", http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := serveReq(t, h, c.userID, "photos/"+c.file)
			if rec.Code != c.want {
				t.Fatalf("%s: got %d, want %d (body: %s)", c.name, rec.Code, c.want, rec.Body.String())
			}
		})
	}
}

// TestServePhotoRejectsThumbsBypass guards the .thumbs/ ACL bypass fix: the
// cache dir is served internally only and a direct request must 404, never
// fall through the ownership check as an "untracked" file.
func TestServePhotoRejectsThumbsBypass(t *testing.T) {
	db := setupDB(t)
	photosDir := t.TempDir()
	cfg := &config.Config{DataDir: photosDir, JWTSecret: serveTestSecret}
	realDir := filepath.Join(photosDir, "photos", ".thumbs", "thumb")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	h := NewMediaHandler(cfg, db, nil)

	childB := mkChild(t, db, "Bo")
	role := mkRole(t, db, "caregiver")
	caregiver := mkUser(t, db, "caregiver", false)
	childA := mkChild(t, db, "Aria")
	grantChild(t, db, caregiver, childA, role)
	mkFeedingPhoto(t, db, childB, "feedings-200.jpg")
	// A cached thumbnail of child B's photo exists on disk.
	if err := os.WriteFile(filepath.Join(realDir, "feedings-200.jpg"), []byte("thumb"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := serveReq(t, h, caregiver, "photos/.thumbs/thumb/feedings-200.jpg")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("direct .thumbs request should 404, got %d", rec.Code)
	}
}
