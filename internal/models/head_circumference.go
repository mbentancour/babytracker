package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type HeadCircumference struct {
	ID                int       `db:"id" json:"id"`
	ChildID           int       `db:"child_id" json:"child"`
	Date              string    `db:"date" json:"date"`
	HeadCircumference float64   `db:"head_circumference" json:"head_circumference"`
	Notes             string    `db:"notes" json:"notes"`
	Photo             string    `db:"photo" json:"photo"`
	CreatedAt         time.Time `db:"created_at" json:"-"`
}

type HeadCircumferenceInput struct {
	Child             int     `json:"child"`
	Date              string  `json:"date"`
	HeadCircumference float64 `json:"head_circumference"`
	Notes             string  `json:"notes"`
}

func CreateHeadCircumference(db *sqlx.DB, h *HeadCircumference) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO head_circumference (child_id, date, head_circumference, notes)
		 VALUES (?, ?, ?, ?) RETURNING *`),
		h.ChildID, h.Date, h.HeadCircumference, h.Notes,
	).StructScan(h)
}

func UpdateHeadCircumference(db *sqlx.DB, id int, updates map[string]any) (*HeadCircumference, error) {
	query, args := buildUpdateQuery("head_circumference", id, updates)
	var h HeadCircumference
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&h)
	return &h, err
}

func DeleteHeadCircumference(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM head_circumference WHERE id = ?`), id)
	return err
}
