package models

import (
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"
)

// ErrIdentityTaken is returned by LinkIdentity when the provider account is
// already linked to a different local user.
var ErrIdentityTaken = errors.New("identity is linked to another user")

// GetUserByIdentity returns the user linked to an OIDC provider account, or
// sql.ErrNoRows when there is none.
func GetUserByIdentity(db *sqlx.DB, issuer, subject string) (*User, error) {
	var user User
	err := db.Get(&user, `
		SELECT u.* FROM users u
		JOIN user_identities i ON i.user_id = u.id
		WHERE i.issuer = $1 AND i.subject = $2`, issuer, subject)
	return &user, err
}

// TouchIdentity records a successful sign-in through a linked identity.
func TouchIdentity(db *sqlx.DB, issuer, subject string) error {
	_, err := db.Exec(`
		UPDATE user_identities SET last_login_at = NOW()
		WHERE issuer = $1 AND subject = $2`, issuer, subject)
	return err
}

// HasIdentity reports whether a user has an identity linked at the issuer.
func HasIdentity(db *sqlx.DB, userID int, issuer string) (bool, error) {
	var n int
	err := db.Get(&n, `SELECT COUNT(*) FROM user_identities WHERE user_id = $1 AND issuer = $2`, userID, issuer)
	return n > 0, err
}

// LinkIdentity links a provider account to an existing user, replacing any
// identity the user already had at that issuer. Returns ErrIdentityTaken if
// the provider account belongs to someone else.
func LinkIdentity(db *sqlx.DB, userID int, issuer, subject string) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var owner int
	err = tx.Get(&owner, `SELECT user_id FROM user_identities WHERE issuer = $1 AND subject = $2`, issuer, subject)
	switch {
	case err == nil && owner != userID:
		return ErrIdentityTaken
	case err == nil:
		return nil // already linked to this user
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}

	if _, err := tx.Exec(`
		INSERT INTO user_identities (user_id, issuer, subject) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, issuer) DO UPDATE SET subject = EXCLUDED.subject, created_at = NOW(), last_login_at = NULL`,
		userID, issuer, subject); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateUserWithIdentity creates a user and links the provider account to it
// in one transaction, so a failed link can't leave an orphan account behind
// that nobody is able to sign in to.
func CreateUserWithIdentity(db *sqlx.DB, username, passwordHash string, isAdmin bool, issuer, subject string) (*User, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var user User
	if err := tx.QueryRowx(
		`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING *`,
		username, passwordHash, isAdmin,
	).StructScan(&user); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(
		`INSERT INTO user_identities (user_id, issuer, subject, last_login_at) VALUES ($1, $2, $3, NOW())`,
		user.ID, issuer, subject); err != nil {
		return nil, err
	}
	return &user, tx.Commit()
}

// SetAdminFromProvider applies the admin flag an OIDC provider asserts for a
// user. A demotion that would leave the instance without any admin is skipped
// rather than applied — the same guard DeleteUser has — and reported as false.
func SetAdminFromProvider(db *sqlx.DB, userID int, isAdmin bool) (applied bool, err error) {
	res, err := db.Exec(`
		UPDATE users SET is_admin = $2, updated_at = NOW()
		WHERE id = $1 AND is_admin <> $2
		  AND ($2 OR (SELECT COUNT(*) FROM users WHERE is_admin) > 1)`,
		userID, isAdmin)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		return true, nil
	}
	// Nothing changed: either the flag already matched, or the guard held.
	var current bool
	if err := db.Get(&current, `SELECT is_admin FROM users WHERE id = $1`, userID); err != nil {
		return false, err
	}
	return current == isAdmin, nil
}
