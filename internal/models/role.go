package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Role struct {
	ID          int       `db:"id" json:"id"`
	Name        string    `db:"name" json:"name"`
	Description string    `db:"description" json:"description"`
	IsSystem    bool      `db:"is_system" json:"is_system"`
	CreatedAt   time.Time `db:"created_at" json:"-"`
}

type RolePermission struct {
	ID          int    `db:"id" json:"id"`
	RoleID      int    `db:"role_id" json:"role_id"`
	Feature     string `db:"feature" json:"feature"`
	AccessLevel string `db:"access_level" json:"access_level"`
}

type UserChild struct {
	ID        int       `db:"id" json:"id"`
	UserID    int       `db:"user_id" json:"user_id"`
	ChildID   int       `db:"child_id" json:"child_id"`
	RoleID    int       `db:"role_id" json:"role_id"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

// RoleWithPermissions is returned by the API for display
type RoleWithPermissions struct {
	Role
	Permissions []RolePermission `json:"permissions"`
}

// UserAccess describes what a user can access
type UserAccess struct {
	ChildID     int              `json:"child_id"`
	ChildName   string           `json:"child_name"`
	RoleID      int              `json:"role_id"`
	RoleName    string           `json:"role_name"`
	Permissions []RolePermission `json:"permissions"`
}

func ListRoles(db *sqlx.DB) ([]Role, error) {
	var roles []Role
	err := db.Select(&roles, `SELECT * FROM roles ORDER BY is_system DESC, name`)
	if err != nil {
		return nil, err
	}
	if roles == nil {
		roles = []Role{}
	}
	return roles, nil
}

func GetRole(db *sqlx.DB, id int) (*Role, error) {
	var role Role
	err := db.Get(&role, `SELECT * FROM roles WHERE id = $1`, id)
	return &role, err
}

func CreateRole(db *sqlx.DB, name, description string) (*Role, error) {
	var role Role
	err := db.QueryRowx(
		`INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *`,
		name, description,
	).StructScan(&role)
	return &role, err
}

func DeleteRole(db *sqlx.DB, id int) error {
	// Don't allow deleting system roles
	_, err := db.Exec(`DELETE FROM roles WHERE id = $1 AND is_system = FALSE`, id)
	return err
}

func GetRolePermissions(db *sqlx.DB, roleID int) ([]RolePermission, error) {
	var perms []RolePermission
	err := db.Select(&perms, `SELECT * FROM role_permissions WHERE role_id = $1 ORDER BY feature`, roleID)
	if err != nil {
		return nil, err
	}
	if perms == nil {
		perms = []RolePermission{}
	}
	return perms, nil
}

func SetRolePermission(db *sqlx.DB, roleID int, feature, accessLevel string) error {
	_, err := db.Exec(
		`INSERT INTO role_permissions (role_id, feature, access_level)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (role_id, feature) DO UPDATE SET access_level = $3`,
		roleID, feature, accessLevel,
	)
	return err
}

func SetRolePermissions(db *sqlx.DB, roleID int, perms map[string]string) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for feature, level := range perms {
		_, err = tx.Exec(
			`INSERT INTO role_permissions (role_id, feature, access_level)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (role_id, feature) DO UPDATE SET access_level = $3`,
			roleID, feature, level,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// User-child access

func GetUserChildAccess(db *sqlx.DB, userID int) ([]UserAccess, error) {
	var results []UserAccess
	rows, err := db.Queryx(`
		SELECT uc.child_id, c.first_name AS child_name, uc.role_id, r.name AS role_name
		FROM user_children uc
		JOIN children c ON c.id = uc.child_id
		JOIN roles r ON r.id = uc.role_id
		WHERE uc.user_id = $1
		ORDER BY c.first_name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var ua UserAccess
		if err := rows.Scan(&ua.ChildID, &ua.ChildName, &ua.RoleID, &ua.RoleName); err != nil {
			continue
		}
		ua.Permissions, _ = GetRolePermissions(db, ua.RoleID)
		results = append(results, ua)
	}
	if results == nil {
		results = []UserAccess{}
	}
	return results, nil
}

func GrantChildAccess(db *sqlx.DB, userID, childID, roleID int) error {
	_, err := db.Exec(
		`INSERT INTO user_children (user_id, child_id, role_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, child_id) DO UPDATE SET role_id = $3`,
		userID, childID, roleID,
	)
	return err
}

func RevokeChildAccess(db *sqlx.DB, userID, childID int) error {
	_, err := db.Exec(
		`DELETE FROM user_children WHERE user_id = $1 AND child_id = $2`,
		userID, childID,
	)
	return err
}

// CheckAccess returns the access level for a user+child+feature combination.
// Admin users always get "write". Returns "none" if no access.
func CheckAccess(db *sqlx.DB, userID int, childID int, feature string) string {
	// Check if admin
	var isAdmin bool
	db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)
	if isAdmin {
		return "write"
	}

	var level string
	err := db.Get(&level, `
		SELECT rp.access_level
		FROM user_children uc
		JOIN role_permissions rp ON rp.role_id = uc.role_id
		WHERE uc.user_id = $1 AND uc.child_id = $2 AND rp.feature = $3
	`, userID, childID, feature)
	if err != nil {
		return "none"
	}
	return level
}

// GetAccessibleChildIDs returns which child IDs a user can access.
// Admins get all children.
func GetAccessibleChildIDs(db *sqlx.DB, userID int) ([]int, error) {
	var isAdmin bool
	db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)
	if isAdmin {
		var ids []int
		err := db.Select(&ids, `SELECT id FROM children ORDER BY id`)
		return ids, err
	}

	var ids []int
	err := db.Select(&ids, `SELECT child_id FROM user_children WHERE user_id = $1`, userID)
	return ids, err
}

func ListUsers(db *sqlx.DB) ([]User, error) {
	var users []User
	err := db.Select(&users, `SELECT * FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	if users == nil {
		users = []User{}
	}
	return users, nil
}
