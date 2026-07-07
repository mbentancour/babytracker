package handlers

import (
	"os"
	"sync"
	"testing"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

// Handler integration tests run against a real Postgres so they exercise the
// exact SQL and RBAC/ownership logic the app uses. Point TEST_DATABASE_URL at
// a throwaway database to enable them; without it the suite skips (so plain
// `go test ./...` on a machine without Postgres stays green). CI provides one
// via a postgres service container.
//
//	docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=babytracker \
//	  -e POSTGRES_USER=babytracker -p 5432:5432 postgres:16-alpine
//	TEST_DATABASE_URL='postgres://babytracker:test@localhost:5432/babytracker?sslmode=disable' \
//	  go test ./internal/handlers/

var (
	testDB     *sqlx.DB
	testDBOnce sync.Once
	testDBErr  error
)

// setupDB returns a migrated database with all application data truncated for
// a clean slate. It connects and migrates once per package run, then resets
// the data before each test.
func setupDB(t *testing.T) *sqlx.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run handler integration tests")
	}
	testDBOnce.Do(func() {
		// Migration files live under cmd/babytracker/migrations, two levels up.
		if err := database.RunMigrations(url, os.DirFS("../../cmd/babytracker/migrations")); err != nil {
			testDBErr = err
			return
		}
		testDB, testDBErr = database.Connect(url)
	})
	if testDBErr != nil {
		t.Fatalf("test DB setup failed: %v", testDBErr)
	}
	resetDB(t, testDB)
	return testDB
}

// resetDB truncates every application table (keeping the schema and the
// migration bookkeeping) so each test starts from an empty database.
func resetDB(t *testing.T, db *sqlx.DB) {
	t.Helper()
	var list string
	err := db.Get(&list, `
		SELECT string_agg(quote_ident(tablename), ', ')
		FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`)
	if err != nil {
		t.Fatalf("enumerate tables: %v", err)
	}
	if list == "" {
		return
	}
	if _, err := db.Exec("TRUNCATE " + list + " RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
}

// --- fixture helpers -------------------------------------------------------

func mkUser(t *testing.T, db *sqlx.DB, username string, admin bool) int {
	t.Helper()
	var id int
	err := db.Get(&id,
		`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', $2) RETURNING id`,
		username, admin)
	if err != nil {
		t.Fatalf("mkUser: %v", err)
	}
	return id
}

func mkChild(t *testing.T, db *sqlx.DB, name string) int {
	t.Helper()
	var id int
	err := db.Get(&id,
		`INSERT INTO children (first_name, last_name, birth_date) VALUES ($1, 'Test', '2026-01-01') RETURNING id`,
		name)
	if err != nil {
		t.Fatalf("mkChild: %v", err)
	}
	return id
}

func mkRole(t *testing.T, db *sqlx.DB, name string) int {
	t.Helper()
	var id int
	err := db.Get(&id,
		`INSERT INTO roles (name, is_system) VALUES ($1, false) RETURNING id`, name)
	if err != nil {
		t.Fatalf("mkRole: %v", err)
	}
	return id
}

// grantChild gives a user access to a child under a role.
func grantChild(t *testing.T, db *sqlx.DB, userID, childID, roleID int) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO user_children (user_id, child_id, role_id) VALUES ($1, $2, $3)`,
		userID, childID, roleID)
	if err != nil {
		t.Fatalf("grantChild: %v", err)
	}
}

// mkFeedingPhoto creates a feeding row for a child with a photo filename.
func mkFeedingPhoto(t *testing.T, db *sqlx.DB, childID int, photo string) int {
	t.Helper()
	var id int
	err := db.Get(&id, `
		INSERT INTO feedings (child_id, start_time, end_time, type, method, photo)
		VALUES ($1, NOW(), NOW(), 'breast milk', 'bottle', $2) RETURNING id`,
		childID, photo)
	if err != nil {
		t.Fatalf("mkFeedingPhoto: %v", err)
	}
	return id
}
