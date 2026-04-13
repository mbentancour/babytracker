package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Child struct {
	ID        int       `db:"id" json:"id"`
	FirstName string    `db:"first_name" json:"first_name"`
	LastName  string    `db:"last_name" json:"last_name"`
	BirthDate string    `db:"birth_date" json:"birth_date"`
	Picture   string    `db:"picture" json:"picture"`
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
		`INSERT INTO children (first_name, last_name, birth_date, picture)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		c.FirstName, c.LastName, c.BirthDate, c.Picture,
	).StructScan(c)
}

func UpdateChild(db *sqlx.DB, id int, updates map[string]any) (*Child, error) {
	query, args := buildUpdateQuery("children", id, updates)
	var child Child
	err := db.QueryRowx(query, args...).StructScan(&child)
	return &child, err
}

func GetChild(db *sqlx.DB, id int) (*Child, error) {
	var child Child
	err := db.Get(&child, `SELECT * FROM children WHERE id = $1`, id)
	return &child, err
}
