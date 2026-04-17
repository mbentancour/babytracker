package models

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type RefreshToken struct {
	ID        int       `db:"id"`
	UserID    int       `db:"user_id"`
	TokenHash string    `db:"token_hash"`
	ExpiresAt time.Time `db:"expires_at"`
	CreatedAt time.Time `db:"created_at"`
}

func CreateRefreshToken(db *sqlx.DB, userID int, tokenHash string, expiresAt time.Time) error {
	_, err := db.Exec(
		database.Q(db, `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`),
		userID, tokenHash, expiresAt,
	)
	return err
}

func GetRefreshTokenByHash(db *sqlx.DB, tokenHash string) (*RefreshToken, error) {
	var rt RefreshToken
	err := db.Get(&rt, database.Q(db, fmt.Sprintf(`SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > %s`, database.Now())), tokenHash)
	return &rt, err
}

func DeleteRefreshToken(db *sqlx.DB, tokenHash string) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM refresh_tokens WHERE token_hash = ?`), tokenHash)
	return err
}

func DeleteUserRefreshTokens(db *sqlx.DB, userID int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM refresh_tokens WHERE user_id = ?`), userID)
	return err
}

func CleanExpiredRefreshTokens(db *sqlx.DB) error {
	_, err := db.Exec(database.Q(db, fmt.Sprintf(`DELETE FROM refresh_tokens WHERE expires_at < %s`, database.Now())))
	return err
}
