package database

import (
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"

	// Register the pure-Go SQLite driver. glebarez/go-sqlite wraps
	// modernc.org/sqlite and adds time.Time scanning from TEXT columns —
	// without it, TIMESTAMPTZ→TEXT migration columns fail on Scan with
	// "unsupported Scan, storing driver.Value type string into type *time.Time".
	_ "github.com/glebarez/go-sqlite"
)

// ConnectRaw opens a database connection without setting the global Active
// dialect. Used by the migration tool which connects to two databases
// simultaneously (potentially of different types).
func ConnectRaw(databaseURL string) (*sqlx.DB, Dialect, error) {
	dialect, connStr := ParseDatabaseURL(databaseURL)
	var db *sqlx.DB
	var err error
	switch dialect {
	case SQLite:
		db, err = connectSQLite(connStr)
	default:
		db, err = connectPostgres(connStr)
	}
	return db, dialect, err
}

// Connect opens a database connection, auto-detecting the backend from the
// URL scheme. Sets the package-level Active dialect so query helpers (Q,
// Now, DateCast, Concat) return the right SQL for the rest of the process
// lifetime.
func Connect(databaseURL string) (*sqlx.DB, error) {
	dialect, connStr := ParseDatabaseURL(databaseURL)
	Active = dialect

	switch dialect {
	case SQLite:
		return connectSQLite(connStr)
	default:
		return connectPostgres(connStr)
	}
}

func connectPostgres(databaseURL string) (*sqlx.DB, error) {
	// Force every pooled connection's session TimeZone to UTC. Without this,
	// Postgres parses raw timestamp literals ("2026-04-16T14:00:00") against
	// the container's local TZ, which means PATCH handlers — which pass the
	// date as a string straight through buildUpdateQuery — silently shift
	// stored timestamps by the server's UTC offset on every edit.
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	if config.RuntimeParams == nil {
		config.RuntimeParams = map[string]string{}
	}
	if _, set := config.RuntimeParams["timezone"]; !set {
		config.RuntimeParams["timezone"] = "UTC"
	}

	db, err := sqlx.Connect("pgx", stdlib.RegisterConnConfig(config))
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}

func connectSQLite(path string) (*sqlx.DB, error) {
	// WAL mode for better concurrent read performance, foreign keys on for
	// referential integrity, busy_timeout so concurrent readers don't
	// immediately get SQLITE_BUSY. _time_format tells the modernc driver
	// how to parse TEXT timestamps back into time.Time (without it, scanning
	// a DEFAULT datetime('now') column into *time.Time fails with
	// "unsupported Scan").
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"

	db, err := sqlx.Connect("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	// SQLite serialises writes through a single connection. Keeping one open
	// connection avoids "database is locked" under concurrent request load.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	return db, nil
}
