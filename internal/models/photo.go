package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Photo struct {
	ID        int       `db:"id" json:"id"`
	Filename  string    `db:"filename" json:"filename"`
	Caption   string    `db:"caption" json:"caption"`
	Date      string    `db:"date" json:"date"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

func CreatePhoto(db *sqlx.DB, p *Photo) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO photos (filename, caption, date)
		 VALUES (?, ?, ?) RETURNING *`),
		p.Filename, p.Caption, p.Date,
	).StructScan(p)
}

// TagPhotoWithChild adds a child tag to a photo.
func TagPhotoWithChild(db *sqlx.DB, filename string, childID int) error {
	_, err := db.Exec(
		database.Q(db, `INSERT INTO photo_children (photo_filename, child_id) VALUES (?, ?) ON CONFLICT DO NOTHING`),
		filename, childID,
	)
	return err
}

func UpdatePhoto(db *sqlx.DB, id int, updates map[string]any) (*Photo, error) {
	query, args := buildUpdateQuery("photos", id, updates)
	var p Photo
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&p)
	return &p, err
}

func DeletePhoto(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM photos WHERE id = ?`), id)
	return err
}

func GetPhoto(db *sqlx.DB, id int) (*Photo, error) {
	var p Photo
	err := db.Get(&p, database.Q(db, `SELECT * FROM photos WHERE id = ?`), id)
	return &p, err
}
