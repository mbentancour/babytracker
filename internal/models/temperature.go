package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Temperature struct {
	ID          int       `db:"id" json:"id"`
	ChildID     int       `db:"child_id" json:"child"`
	Time        time.Time `db:"time" json:"time"`
	Temperature float64   `db:"temperature" json:"temperature"`
	Notes       string    `db:"notes" json:"notes"`
	Photo       string    `db:"photo" json:"photo"`
	CreatedAt   time.Time `db:"created_at" json:"-"`
}

type TemperatureInput struct {
	Child       int     `json:"child"`
	Time        string  `json:"time"`
	Temperature float64 `json:"temperature"`
	Notes       string  `json:"notes"`
}

func CreateTemperature(db *sqlx.DB, t *Temperature) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO temperature (child_id, time, temperature, notes)
		 VALUES (?, ?, ?, ?) RETURNING *`),
		t.ChildID, t.Time, t.Temperature, t.Notes,
	).StructScan(t)
}

func UpdateTemperature(db *sqlx.DB, id int, updates map[string]any) (*Temperature, error) {
	query, args := buildUpdateQuery("temperature", id, updates)
	var t Temperature
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&t)
	return &t, err
}
