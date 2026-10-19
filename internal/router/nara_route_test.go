package router

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/database"
)

var routerTestDBs atomic.Int32

// routerTestDB creates a database of its own next to TEST_DATABASE_URL's, so
// this package's tests don't race the handlers package's tests, which
// truncate the shared database (go test runs packages in parallel). The
// TEST_DATABASE_URL role needs CREATEDB, as the documented setup's has.
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
	name := fmt.Sprintf("babytracker_router_test_%d_%d", os.Getpid(), routerTestDBs.Add(1))
	// A run that was killed (a -timeout panic skips cleanups) leaves its
	// database behind; a later run that gets the same name replaces it.
	drop := `DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`
	if _, err := admin.Exec(drop); err != nil {
		t.Fatalf("drop leftover test database: %v", err)
	}
	if _, err := admin.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatalf("create test database (the TEST_DATABASE_URL role needs CREATEDB): %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(drop); err != nil {
			t.Logf("drop test database %s: %v", name, err)
		}
	})

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

// naraTestAdmin adds an admin to db and returns a router config and an access
// token for them.
func naraTestAdmin(t *testing.T, db *sqlx.DB) (*config.Config, string) {
	t.Helper()
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
	return cfg, token
}

// naraUpload renders a multipart body holding an export and form fields.
func naraUpload(t *testing.T, csv string, fields map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "export.csv")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte(csv))
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	return &body, mw.FormDataContentType()
}

// The Nara import takes a file upload of several MB, so its routes must not
// sit behind the 1 MB body limit the JSON API routes share. This goes
// through the real router so a route moved back into that group fails here.
func TestNaraImportAcceptsUploadsOverOneMB(t *testing.T) {
	db := routerTestDB(t)
	cfg, token := naraTestAdmin(t, db)
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
		body, contentType := naraUpload(t, csv.String(), c.fields)
		if body.Len() <= 1<<20 {
			t.Fatalf("test body is only %d bytes", body.Len())
		}
		req := httptest.NewRequest(http.MethodPost, c.path, body)
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: status %d body %.300s", c.path, rec.Code, rec.Body.String())
		}
	}
}

// A large import can take longer than the server's WriteTimeout (5 minutes in
// production). The import routes extend their deadlines, so the summary still
// reaches the client instead of the connection being cut after the import
// committed. That needs every middleware's ResponseWriter wrapper to unwrap,
// so this goes through the real router and server.
func TestNaraImportOutlivesTheServersWriteTimeout(t *testing.T) {
	db := routerTestDB(t)
	cfg, token := naraTestAdmin(t, db)
	// Make the import outlast the server's timeouts below, which leave the
	// middleware ample time to hand over before the handler extends them.
	for _, q := range []string{
		`CREATE FUNCTION slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`,
		`CREATE TRIGGER slow_insert BEFORE INSERT ON children FOR EACH ROW EXECUTE FUNCTION slow_insert()`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	srv := httptest.NewUnstartedServer(New(db, cfg))
	srv.Config.ReadHeaderTimeout = 10 * time.Second
	srv.Config.ReadTimeout = time.Second
	srv.Config.WriteTimeout = time.Second
	srv.Start()
	defer srv.Close()

	epoch := time.Now().Add(-time.Hour).UnixMilli()
	body, contentType := naraUpload(t, fmt.Sprintf("\"Type\",\"Start Date/time (Epoch)\",\"[Diaper] Type\"\n\"Diaper\",\"%d\",\"Wet\"\n", epoch),
		map[string]string{"first_name": "Rosa", "birth_date": "2026-01-01"})
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/import/nara", body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("no response: %v", err)
	}
	defer resp.Body.Close()
	got, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK || !strings.Contains(string(got), `"status":"completed"`) {
		t.Fatalf("status %d body %.300s (%v)", resp.StatusCode, got, err)
	}
}
