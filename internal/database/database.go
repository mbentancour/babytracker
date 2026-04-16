package database

import (
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

func Connect(databaseURL string) (*sqlx.DB, error) {
	// Force every pooled connection's session TimeZone to UTC. Without this,
	// Postgres parses raw timestamp literals ("2026-04-16T14:00:00") against
	// the container's local TZ, which means PATCH handlers — which pass the
	// date as a string straight through buildUpdateQuery — silently shift
	// stored timestamps by the server's UTC offset on every edit. Go handlers
	// that build time.Time values are unaffected (the driver tags them), so
	// creates look correct while edits drift. Setting session TZ to UTC
	// normalises both paths.
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
