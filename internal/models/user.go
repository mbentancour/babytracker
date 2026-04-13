package models

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type User struct {
	ID           int       `db:"id" json:"id"`
	Username     string    `db:"username" json:"username"`
	PasswordHash string    `db:"password_hash" json:"-"`
	IsAdmin      bool      `db:"is_admin" json:"is_admin"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}

func CreateUser(db *sqlx.DB, username, passwordHash string, isAdmin bool) (*User, error) {
	var user User
	err := db.QueryRowx(
		`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING *`,
		username, passwordHash, isAdmin,
	).StructScan(&user)
	return &user, err
}

func DeleteUser(db *sqlx.DB, id int) error {
	// Don't allow deleting the last admin
	var adminCount int
	db.Get(&adminCount, `SELECT COUNT(*) FROM users WHERE is_admin = TRUE`)
	var isAdmin bool
	db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, id)
	if isAdmin && adminCount <= 1 {
		return fmt.Errorf("cannot delete the last admin")
	}
	_, err := db.Exec(`DELETE FROM users WHERE id = $1`, id)
	return err
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
