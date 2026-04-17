package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Child struct {
	ID        int       `db:"id" json:"id"`
	FirstName string    `db:"first_name" json:"first_name"`
	LastName  string    `db:"last_name" json:"last_name"`
	BirthDate string    `db:"birth_date" json:"birth_date"`
	Picture   string    `db:"picture" json:"picture"`
	Sex       *string   `db:"sex" json:"sex"`
	CreatedAt time.Time `db:"created_at" json:"-"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

func ListChildren(db *sqlx.DB) ([]Child, error) {
	var children []Child
	err := db.Select(&children, `SELECT * FROM children ORDER BY id`)
	if err != nil {
		return nil, err
	}
	if children == nil {
		children = []Child{}
	}
	return children, nil
}

func CreateChild(db *sqlx.DB, c *Child) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO children (first_name, last_name, birth_date, picture, sex)
		 VALUES (?, ?, ?, ?, ?) RETURNING *`),
		c.FirstName, c.LastName, c.BirthDate, c.Picture, c.Sex,
	).StructScan(c)
}

func UpdateChild(db *sqlx.DB, id int, updates map[string]any) (*Child, error) {
	query, args := buildUpdateQuery("children", id, updates)
	var child Child
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&child)
	return &child, err
}

func GetChild(db *sqlx.DB, id int) (*Child, error) {
	var child Child
	err := db.Get(&child, database.Q(db, `SELECT * FROM children WHERE id = ?`), id)
	return &child, err
}
