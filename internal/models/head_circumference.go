package models

import (
	"time"

	"github.com/jmoiron/sqlx"
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
		`INSERT INTO head_circumference (child_id, date, head_circumference, notes)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		h.ChildID, h.Date, h.HeadCircumference, h.Notes,
	).StructScan(h)
}

func UpdateHeadCircumference(db *sqlx.DB, id int, updates map[string]any) (*HeadCircumference, error) {
	query, args := buildUpdateQuery("head_circumference", id, updates)
	var h HeadCircumference
	err := db.QueryRowx(query, args...).StructScan(&h)
	return &h, err
}

func DeleteHeadCircumference(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM head_circumference WHERE id = $1`, id)
	return err
}
