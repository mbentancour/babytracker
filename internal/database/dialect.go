package database

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/jmoiron/sqlx"
)

// Dialect identifies which SQL backend is active. Set once during Connect and
// read by query helpers throughout the request lifecycle.
type Dialect string

const (
	Postgres Dialect = "postgres"
	SQLite   Dialect = "sqlite"
)

// Active holds the dialect detected from DATABASE_URL at startup. Safe to
// read concurrently after Connect returns — never written again.
var Active Dialect

// IsSQLite returns true when the active backend is SQLite.
func IsSQLite() bool { return Active == SQLite }

// Q rebinds a query written with ? placeholders to the active driver's
// style. Postgres: ? → $1, $2, ... SQLite: ? stays as ?.
// Every raw-SQL call site wraps its query in Q(db, ...) so the same source
// string works on both backends.
func Q(db *sqlx.DB, query string) string {
	return sqlx.Rebind(sqlx.BindType(db.DriverName()), query)
}

// Now returns the SQL expression for "current UTC timestamp".
func Now() string {
	if Active == SQLite {
		return "datetime('now')"
	}
	return "NOW()"
}

// DateCast converts a timestamp column to a date-as-text string.
// Postgres: col::date::text   SQLite: date(col)
func DateCast(col string) string {
	if Active == SQLite {
		return fmt.Sprintf("date(%s)", col)
	}
	return fmt.Sprintf("%s::date::text", col)
}

// DateToText converts a date column to a text string.
// Postgres: col::text   SQLite: col  (already text in SQLite)
func DateToText(col string) string {
	if Active == SQLite {
		return col
	}
	return fmt.Sprintf("%s::text", col)
}

// Concat builds a string-concatenation expression.
// Postgres: CONCAT(a, b, c)   SQLite: a || b || c
func Concat(parts ...string) string {
	if Active == SQLite {
		return "(" + strings.Join(parts, " || ") + ")"
	}
	return "CONCAT(" + strings.Join(parts, ", ") + ")"
}

// ParseDatabaseURL inspects the raw DATABASE_URL and returns the dialect
// plus a connection string suitable for the chosen driver.
//
// Detection rules:
//   - "postgres://..." or "postgresql://..." → Postgres
//   - "sqlite://..." → SQLite (strips scheme, returns bare path)
//   - Bare path containing "/" or ending in ".db" → SQLite
//   - Anything else → Postgres (backwards compat)
func ParseDatabaseURL(raw string) (Dialect, string) {
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "postgres://"),
		strings.HasPrefix(lower, "postgresql://"):
		return Postgres, raw
	case strings.HasPrefix(lower, "sqlite://"):
		return SQLite, strings.TrimPrefix(raw, "sqlite://")
	case strings.HasSuffix(lower, ".db"),
		strings.HasSuffix(lower, ".sqlite"),
		strings.HasSuffix(lower, ".sqlite3"):
		return SQLite, raw
	case strings.Contains(raw, string(filepath.Separator)) && !strings.Contains(raw, "://"):
		return SQLite, raw
	default:
		return Postgres, raw
	}
}
