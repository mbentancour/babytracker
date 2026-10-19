package router

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/database"
)

// routerTestDB creates a database of its own next to TEST_DATABASE_URL's, so
// this package's tests don't race the handlers package's tests, which
// truncate the shared database (go test runs packages in parallel).
func routerTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("set TEST_DATABASE_URL to run router integration tests")
	}
	admin, err := database.Connect(base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	name := fmt.Sprintf("babytracker_router_test_%d", os.Getpid())
	if _, err := admin.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() { admin.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`) })

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	if err := database.RunMigrations(u.String(), os.DirFS("../../cmd/babytracker/migrations")); err != nil {
		t.Fatal(err)
	}
	db, err := database.Connect(u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// The Nara import takes a file upload of several MB, so its routes must not
// sit behind the 1 MB body limit the JSON API routes share. This goes
// through the real router so a route moved back into that group fails here.
func TestNaraImportAcceptsUploadsOverOneMB(t *testing.T) {
	db := routerTestDB(t)
	var adminID int
	if err := db.Get(&adminID, `INSERT INTO users (username, password_hash, is_admin) VALUES ('admin', 'x', true) RETURNING id`); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{JWTSecret: "router-test-secret-0123456789abcdef", UnitSystem: "metric", DataDir: t.TempDir()}
	cfg.CertsDir = cfg.DataDir
	token, err := crypto.GenerateAccessToken(cfg.JWTSecret, adminID, "admin", true)
	if err != nil {
		t.Fatal(err)
	}
	h := New(db, cfg)

	// About 1.5 MB of diaper rows in Nara's quoted layout.
	var csv strings.Builder
	csv.WriteString("\"Type\",\"Start Date/time (Epoch)\",\"[Diaper] Type\",\"Note\"\n")
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	padding := strings.Repeat("n", 280)
	for i := 0; csv.Len() < 3<<19; i++ {
		fmt.Fprintf(&csv, "\"Diaper\",\"%d\",\"Wet\",\"%s\"\n", start+int64(i)*60000, padding)
	}

	for _, c := range []struct {
		path   string
		fields map[string]string
		want   string
	}{
		{"/api/import/nara/preview", nil, `"status":"preview"`},
		{"/api/import/nara", map[string]string{"first_name": "Rosa", "birth_date": "2026-01-01"}, `"status":"completed"`},
	} {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", "export.csv")
		fw.Write([]byte(csv.String()))
		for k, v := range c.fields {
			mw.WriteField(k, v)
		}
		mw.Close()
		if body.Len() <= 1<<20 {
			t.Fatalf("test body is only %d bytes", body.Len())
		}
		req := httptest.NewRequest(http.MethodPost, c.path, &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: status %d body %.300s", c.path, rec.Code, rec.Body.String())
		}
	}
}
