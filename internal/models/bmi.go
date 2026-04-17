package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type BMI struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Date      string    `db:"date" json:"date"`
	BMI       float64   `db:"bmi" json:"bmi"`
	Notes     string    `db:"notes" json:"notes"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type BMIInput struct {
	Child int     `json:"child"`
	Date  string  `json:"date"`
	BMI   float64 `json:"bmi"`
	Notes string  `json:"notes"`
}

func CreateBMI(db *sqlx.DB, b *BMI) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO bmi (child_id, date, bmi, notes, photo)
		 VALUES (?, ?, ?, ?, ?) RETURNING *`),
		b.ChildID, b.Date, b.BMI, b.Notes, b.Photo,
	).StructScan(b)
}

func UpdateBMI(db *sqlx.DB, id int, updates map[string]any) (*BMI, error) {
	query, args := buildUpdateQuery("bmi", id, updates)
	var b BMI
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&b)
	return &b, err
}

func DeleteBMI(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM bmi WHERE id = ?`), id)
	return err
}
