package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Change struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Time      time.Time `db:"time" json:"time"`
	Wet       bool      `db:"wet" json:"wet"`
	Solid     bool      `db:"solid" json:"solid"`
	Color     string    `db:"color" json:"color"`
	Amount    *float64  `db:"amount" json:"amount"`
	Notes     string    `db:"notes" json:"notes"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type ChangeInput struct {
	Child  int      `json:"child"`
	Time   string   `json:"time"`
	Wet    bool     `json:"wet"`
	Solid  bool     `json:"solid"`
	Color  string   `json:"color"`
	Amount *float64 `json:"amount"`
	Notes  string   `json:"notes"`
}

func CreateChange(db *sqlx.DB, c *Change) error {
	return db.QueryRowx(
		`INSERT INTO changes (child_id, time, wet, solid, color, amount, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
		c.ChildID, c.Time, c.Wet, c.Solid, c.Color, c.Amount, c.Notes,
	).StructScan(c)
}

func UpdateChange(db *sqlx.DB, id int, updates map[string]any) (*Change, error) {
	query, args := buildUpdateQuery("changes", id, updates)
	var c Change
	err := db.QueryRowx(query, args...).StructScan(&c)
	return &c, err
}
