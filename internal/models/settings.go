package models

import (
	"github.com/jmoiron/sqlx"
)

func GetSetting(db *sqlx.DB, key string) (string, error) {
	var value string
	err := db.Get(&value, `SELECT value FROM settings WHERE key = $1`, key)
	return value, err
}

func SetSetting(db *sqlx.DB, key, value string) error {
	_, err := db.Exec(
		`INSERT INTO settings (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = $2`,
		key, value,
	)
	return err
}
