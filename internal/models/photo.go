package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Photo struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Filename  string    `db:"filename" json:"filename"`
	Caption   string    `db:"caption" json:"caption"`
	Date      string    `db:"date" json:"date"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

func CreatePhoto(db *sqlx.DB, p *Photo) error {
	return db.QueryRowx(
		`INSERT INTO photos (child_id, filename, caption, date)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		p.ChildID, p.Filename, p.Caption, p.Date,
	).StructScan(p)
}

func UpdatePhoto(db *sqlx.DB, id int, updates map[string]any) (*Photo, error) {
	query, args := buildUpdateQuery("photos", id, updates)
	var p Photo
	err := db.QueryRowx(query, args...).StructScan(&p)
	return &p, err
}

func DeletePhoto(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM photos WHERE id = $1`, id)
	return err
}

func GetPhoto(db *sqlx.DB, id int) (*Photo, error) {
	var p Photo
	err := db.Get(&p, `SELECT * FROM photos WHERE id = $1`, id)
	return &p, err
}
