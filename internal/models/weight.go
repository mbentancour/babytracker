package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Weight struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Date      string    `db:"date" json:"date"`
	Weight    float64   `db:"weight" json:"weight"`
	Notes     string    `db:"notes" json:"notes"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type WeightInput struct {
	Child  int     `json:"child"`
	Date   string  `json:"date"`
	Weight float64 `json:"weight"`
	Notes  string  `json:"notes"`
}

func CreateWeight(db *sqlx.DB, w *Weight) error {
	return db.QueryRowx(
		`INSERT INTO weight (child_id, date, weight, notes)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		w.ChildID, w.Date, w.Weight, w.Notes,
	).StructScan(w)
}

func UpdateWeight(db *sqlx.DB, id int, updates map[string]any) (*Weight, error) {
	query, args := buildUpdateQuery("weight", id, updates)
	var w Weight
	err := db.QueryRowx(query, args...).StructScan(&w)
	return &w, err
}
