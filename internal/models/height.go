package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Height struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Date      string    `db:"date" json:"date"`
	Height    float64   `db:"height" json:"height"`
	Notes     string    `db:"notes" json:"notes"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type HeightInput struct {
	Child  int     `json:"child"`
	Date   string  `json:"date"`
	Height float64 `json:"height"`
	Notes  string  `json:"notes"`
}

func CreateHeight(db *sqlx.DB, h *Height) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO height (child_id, date, height, notes)
		 VALUES (?, ?, ?, ?) RETURNING *`),
		h.ChildID, h.Date, h.Height, h.Notes,
	).StructScan(h)
}

func UpdateHeight(db *sqlx.DB, id int, updates map[string]any) (*Height, error) {
	query, args := buildUpdateQuery("height", id, updates)
	var h Height
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&h)
	return &h, err
}
