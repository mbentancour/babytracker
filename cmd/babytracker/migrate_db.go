package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/mbentancour/babytracker/internal/database"
)

// migrationTables lists tables in FK dependency order. schema_migrations is
// excluded (managed by golang-migrate). settings is handled separately because
// it may not exist on all schema versions.
var migrationTables = []string{
	"users",
	"children",
	"roles",
	"role_permissions",
	"user_children",
	"feedings",
	"sleep",
	"changes",
	"tummy_times",
	"temperature",
	"weight",
	"height",
	"head_circumference",
	"pumping",
	"medications",
	"milestones",
	"notes",
	"bmi",
	"timers",
	"reminders",
	"api_tokens",
	"refresh_tokens",
	"webhooks",
	"tags",
	"entry_tags",
	"photos",
	"photo_children",
	"backup_destinations",
}

// Tables that have a SERIAL/AUTOINCREMENT id column and need sequence resets
// on Postgres targets.
var sequenceTables = []string{
	"users",
	"children",
	"roles",
	"role_permissions",
	"user_children",
	"feedings",
	"sleep",
	"changes",
	"tummy_times",
	"temperature",
	"weight",
	"height",
	"head_circumference",
	"pumping",
	"medications",
	"milestones",
	"notes",
	"bmi",
	"timers",
	"reminders",
	"api_tokens",
	"refresh_tokens",
	"webhooks",
	"tags",
	"entry_tags",
	"photos",
	"photo_children",
	"backup_destinations",
}

func runMigrateDB() error {
	flagSet := flag.NewFlagSet("migrate-db", flag.ExitOnError)
	from := flagSet.String("from", "", "Source database URL (postgres:// or sqlite path)")
	to := flagSet.String("to", "", "Target database URL (postgres:// or sqlite path)")
	flagSet.Parse(os.Args[2:])

	if *from == "" || *to == "" {
		return fmt.Errorf("usage: babytracker migrate-db --from <url> --to <url>")
	}

	slog.Info("connecting to source database", "url", redactURL(*from))
	srcDB, srcDialect, err := database.ConnectRaw(*from)
	if err != nil {
		return fmt.Errorf("connect to source: %w", err)
	}
	defer srcDB.Close()

	slog.Info("connecting to target database", "url", redactURL(*to))
	tgtDB, tgtDialect, err := database.ConnectRaw(*to)
	if err != nil {
		return fmt.Errorf("connect to target: %w", err)
	}
	defer tgtDB.Close()

	// Run schema migrations on the target so all tables exist.
	slog.Info("applying schema migrations on target")
	if err := runTargetMigrations(*to, tgtDialect); err != nil {
		return fmt.Errorf("target migrations: %w", err)
	}

	// Build full table list: standard tables + settings if it exists.
	tables := make([]string, len(migrationTables))
	copy(tables, migrationTables)
	if tableExists(srcDB, srcDialect, "settings") {
		tables = append(tables, "settings")
	}

	totalRows := 0
	migratedTables := 0

	for _, table := range tables {
		if !tableExists(srcDB, srcDialect, table) {
			slog.Info("skipping table (not in source)", "table", table)
			continue
		}
		if !tableExists(tgtDB, tgtDialect, table) {
			slog.Info("skipping table (not in target)", "table", table)
			continue
		}

		n, err := migrateTable(srcDB, tgtDB, table)
		if err != nil {
			return fmt.Errorf("migrate table %s: %w", table, err)
		}
		totalRows += n
		migratedTables++
	}

	// Reset Postgres sequences so the next INSERT gets the right id.
	if tgtDialect == database.Postgres {
		slog.Info("resetting Postgres sequences")
		resetPostgresSequences(tgtDB)
	}

	fmt.Printf("\nMigration complete:\n")
	fmt.Printf("  Source: %s\n", redactURL(*from))
	fmt.Printf("  Target: %s\n", redactURL(*to))
	fmt.Printf("  Tables: %d\n", migratedTables)
	fmt.Printf("  Total rows: %d\n", totalRows)

	return nil
}

func runTargetMigrations(targetURL string, dialect database.Dialect) error {
	var migFS fs.FS
	var err error
	if dialect == database.SQLite {
		migFS, err = fs.Sub(sqliteMigrationsFS, "migrations/sqlite")
	} else {
		migFS, err = fs.Sub(pgMigrationsFS, "migrations/postgres")
	}
	if err != nil {
		return fmt.Errorf("access embedded migrations: %w", err)
	}
	return database.RunMigrationsWithDialect(targetURL, migFS, dialect)
}

func migrateTable(src, tgt *sqlx.DB, table string) (int, error) {
	rows, err := src.Queryx(fmt.Sprintf("SELECT * FROM %s", table))
	if err != nil {
		return 0, fmt.Errorf("select from %s: %w", table, err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return 0, fmt.Errorf("columns for %s: %w", table, err)
	}
	if len(columns) == 0 {
		return 0, nil
	}

	// Build INSERT with ? placeholders, then rebind for target driver.
	placeholders := make([]string, len(columns))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	insertSQL := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		table,
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "))
	insertSQL = sqlx.Rebind(sqlx.BindType(tgt.DriverName()), insertSQL)

	tx, err := tgt.Beginx()
	if err != nil {
		return 0, fmt.Errorf("begin tx for %s: %w", table, err)
	}
	defer tx.Rollback()

	count := 0
	for rows.Next() {
		vals, err := rows.SliceScan()
		if err != nil {
			return 0, fmt.Errorf("scan row in %s: %w", table, err)
		}
		if _, err := tx.Exec(insertSQL, vals...); err != nil {
			return 0, fmt.Errorf("insert into %s (row %d): %w", table, count+1, err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterating rows in %s: %w", table, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit %s: %w", table, err)
	}

	slog.Info("migrated table", "table", table, "rows", count)
	return count, nil
}

func resetPostgresSequences(db *sqlx.DB) {
	for _, table := range sequenceTables {
		_, err := db.Exec(fmt.Sprintf(
			"SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM %s",
			table, table))
		if err != nil {
			// Not every table has a serial id — that's fine.
			slog.Debug("skip sequence reset", "table", table, "error", err)
		}
	}
}

func tableExists(db *sqlx.DB, dialect database.Dialect, table string) bool {
	var count int
	var err error
	if dialect == database.SQLite {
		err = db.Get(&count, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", table)
	} else {
		err = db.Get(&count, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name=$1", table)
	}
	return err == nil && count > 0
}

// redactURL masks credentials in database URLs for log output.
func redactURL(url string) string {
	if strings.Contains(url, "@") {
		// postgres://user:pass@host/db → postgres://***@host/db
		at := strings.LastIndex(url, "@")
		scheme := ""
		if idx := strings.Index(url, "://"); idx != -1 {
			scheme = url[:idx+3]
		}
		return scheme + "***" + url[at:]
	}
	return url
}
