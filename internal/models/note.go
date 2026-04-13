package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Note struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Time      time.Time `db:"time" json:"time"`
	Note      string    `db:"note" json:"note"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type NoteInput struct {
	Child int    `json:"child"`
	Time  string `json:"time"`
	Note  string `json:"note"`
}

func CreateNote(db *sqlx.DB, n *Note) error {
	return db.QueryRowx(
		`INSERT INTO notes (child_id, time, note)
		 VALUES ($1, $2, $3) RETURNING *`,
		n.ChildID, n.Time, n.Note,
	).StructScan(n)
}

func UpdateNote(db *sqlx.DB, id int, updates map[string]any) (*Note, error) {
	query, args := buildUpdateQuery("notes", id, updates)
	var n Note
	err := db.QueryRowx(query, args...).StructScan(&n)
	return &n, err
}
