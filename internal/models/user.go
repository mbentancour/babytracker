package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type User struct {
	ID           int       `db:"id" json:"id"`
	Username     string    `db:"username" json:"username"`
	PasswordHash string    `db:"password_hash" json:"-"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}

func CreateUser(db *sqlx.DB, username, passwordHash string) (*User, error) {
	var user User
	err := db.QueryRowx(
		`INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *`,
		username, passwordHash,
	).StructScan(&user)
	return &user, err
}

func GetUserByUsername(db *sqlx.DB, username string) (*User, error) {
	var user User
	err := db.Get(&user, `SELECT * FROM users WHERE username = $1`, username)
	return &user, err
}

func GetUserByID(db *sqlx.DB, id int) (*User, error) {
	var user User
	err := db.Get(&user, `SELECT * FROM users WHERE id = $1`, id)
	return &user, err
}

func CountUsers(db *sqlx.DB) (int, error) {
	var count int
	err := db.Get(&count, `SELECT COUNT(*) FROM users`)
	return count, err
}
