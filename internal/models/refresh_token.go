package models

import (
	"time"

	"github.com/jmoiron/sqlx"
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
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, expiresAt,
	)
	return err
}

func GetRefreshTokenByHash(db *sqlx.DB, tokenHash string) (*RefreshToken, error) {
	var rt RefreshToken
	err := db.Get(&rt, `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`, tokenHash)
	return &rt, err
}

func DeleteRefreshToken(db *sqlx.DB, tokenHash string) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE token_hash = $1`, tokenHash)
	return err
}

func DeleteUserRefreshTokens(db *sqlx.DB, userID int) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
	return err
}

func CleanExpiredRefreshTokens(db *sqlx.DB) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`)
	return err
}
