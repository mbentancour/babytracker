package database

import (
	"io/fs"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

func RunMigrations(databaseURL string, migrationsFS fs.FS) error {
	return RunMigrationsWithDialect(databaseURL, migrationsFS, Active)
}

// RunMigrationsWithDialect applies migrations using an explicit dialect
// instead of the global Active. Used by the migration tool which operates
// on a target database that may differ from the process-global dialect.
func RunMigrationsWithDialect(databaseURL string, migrationsFS fs.FS, dialect Dialect) error {
	source, err := iofs.New(migrationsFS, ".")
	if err != nil {
		return err
	}

	var dbURL string
	if dialect == SQLite {
		// golang-migrate sqlite3 driver expects "sqlite3://path"
		_, connStr := ParseDatabaseURL(databaseURL)
		dbURL = "sqlite3://" + connStr
	} else {
		dbURL = "pgx5://" + stripScheme(databaseURL)
	}

	m, err := migrate.NewWithSourceInstance("iofs", source, dbURL)
	if err != nil {
		return err
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}

	slog.Info("database migrations applied successfully")
	return nil
}

func stripScheme(url string) string {
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if len(url) > len(prefix) && url[:len(prefix)] == prefix {
			return url[len(prefix):]
		}
	}
	return url
}
