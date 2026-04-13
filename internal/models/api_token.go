package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type APIToken struct {
	ID          int        `db:"id" json:"id"`
	UserID      int        `db:"user_id" json:"user_id"`
	Name        string     `db:"name" json:"name"`
	TokenHash   string     `db:"token_hash" json:"-"`
	Permissions string     `db:"permissions" json:"permissions"`
	LastUsedAt  *time.Time `db:"last_used_at" json:"last_used_at"`
	ExpiresAt   *time.Time `db:"expires_at" json:"expires_at"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
}

type APITokenInput struct {
	Name        string `json:"name"`
	Permissions string `json:"permissions"`
	ExpiresAt   string `json:"expires_at"`
}

func CreateAPIToken(db *sqlx.DB, t *APIToken) error {
	return db.QueryRowx(
		`INSERT INTO api_tokens (user_id, name, token_hash, permissions, expires_at)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		t.UserID, t.Name, t.TokenHash, t.Permissions, t.ExpiresAt,
	).StructScan(t)
}

func GetAPITokenByHash(db *sqlx.DB, tokenHash string) (*APIToken, error) {
	var t APIToken
	err := db.Get(&t,
		`SELECT * FROM api_tokens WHERE token_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
		tokenHash,
	)
	return &t, err
}

func ListAPITokens(db *sqlx.DB, userID int) ([]APIToken, error) {
	var tokens []APIToken
	err := db.Select(&tokens,
		`SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	if tokens == nil {
		tokens = []APIToken{}
	}
	return tokens, nil
}

func DeleteAPIToken(db *sqlx.DB, id int, userID int) error {
	_, err := db.Exec(`DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func UpdateAPITokenLastUsed(db *sqlx.DB, id int) error {
	_, err := db.Exec(`UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}
