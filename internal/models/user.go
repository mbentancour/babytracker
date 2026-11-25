package models

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type User struct {
	ID           int    `db:"id" json:"id"`
	Username     string `db:"username" json:"username"`
	PasswordHash string `db:"password_hash" json:"-"`
	IsAdmin      bool   `db:"is_admin" json:"is_admin"`
	// UI is the id of the UI this user gets by default; "" is the default UI.
	UI        string    `db:"ui" json:"ui"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
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

// SetUserUI stores which UI a user gets by default. It reports false when no
// such user exists.
func SetUserUI(db *sqlx.DB, id int, ui string) (bool, error) {
	res, err := db.Exec(`UPDATE users SET ui = $1, updated_at = NOW() WHERE id = $2`, ui, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// defaultUIKey is the settings row that holds the UI for every account that
// has not chosen one of its own.
const defaultUIKey = "default_ui"

// GetDefaultUI returns the installation-wide default UI, or "" when none has
// been set (the frontend then uses its built-in default).
func GetDefaultUI(db *sqlx.DB) (string, error) {
	var ui string
	err := db.Get(&ui, `SELECT value FROM settings WHERE key = $1`, defaultUIKey)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return ui, err
}

// SetDefaultUI stores the installation-wide default UI. "" clears it.
func SetDefaultUI(db *sqlx.DB, ui string) error {
	_, err := db.Exec(
		`INSERT INTO settings (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = $2`, defaultUIKey, ui)
	return err
}
