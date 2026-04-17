package models

import (
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Tag struct {
	ID        int       `db:"id" json:"id"`
	Name      string    `db:"name" json:"name"`
	Color     string    `db:"color" json:"color"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type EntryTag struct {
	ID         int       `db:"id" json:"id"`
	TagID      int       `db:"tag_id" json:"tag_id"`
	EntityType string    `db:"entity_type" json:"entity_type"`
	EntityID   int       `db:"entity_id" json:"entity_id"`
	CreatedAt  time.Time `db:"created_at" json:"-"`
}

type TagInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func ListTags(db *sqlx.DB) ([]Tag, error) {
	var tags []Tag
	err := db.Select(&tags, `SELECT * FROM tags ORDER BY name`)
	if err != nil {
		return nil, err
	}
	if tags == nil {
		tags = []Tag{}
	}
	return tags, nil
}

func CreateTag(db *sqlx.DB, t *Tag) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *`),
		t.Name, t.Color,
	).StructScan(t)
}

func UpdateTag(db *sqlx.DB, id int, updates map[string]any) (*Tag, error) {
	query, args := buildUpdateQuery("tags", id, updates)
	var t Tag
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&t)
	return &t, err
}

func DeleteTag(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM tags WHERE id = ?`), id)
	return err
}

// GetTagsByEntityType returns every (entity_id → tag) association for a
// given entity type. Used by list views so the UI can render tag chips on
// every row without N+1 requests. Result shape is map[entity_id][]Tag.
func GetTagsByEntityType(db *sqlx.DB, entityType string) (map[int][]Tag, error) {
	type row struct {
		EntityID int    `db:"entity_id"`
		TagID    int    `db:"id"`
		Name     string `db:"name"`
		Color    string `db:"color"`
	}
	var rows []row
	err := db.Select(&rows,
		database.Q(db, `SELECT et.entity_id, t.id, t.name, t.color
		 FROM entry_tags et
		 JOIN tags t ON t.id = et.tag_id
		 WHERE et.entity_type = ?
		 ORDER BY et.entity_id, t.name`),
		entityType,
	)
	if err != nil {
		return nil, err
	}
	out := map[int][]Tag{}
	for _, r := range rows {
		out[r.EntityID] = append(out[r.EntityID], Tag{ID: r.TagID, Name: r.Name, Color: r.Color})
	}
	return out, nil
}

// GetTagsByEntityTypeForChildren is the tenancy-scoped variant of
// GetTagsByEntityType. It joins entry_tags against the entity's source table
// (via TagEntityTypeToTable) and returns only rows whose child_id is in the
// caller's accessible set. Unknown entity types return an empty result — the
// allow-list keeps the fmt.Sprintf safe even though the join target is
// dynamic. Admins should pass the full accessible set from
// GetAccessibleChildIDs; non-admins their own.
func GetTagsByEntityTypeForChildren(db *sqlx.DB, entityType string, childIDs []int) (map[int][]Tag, error) {
	table, ok := TagEntityTypeToTable[entityType]
	if !ok || len(childIDs) == 0 {
		return map[int][]Tag{}, nil
	}
	placeholders := make([]string, len(childIDs))
	args := make([]any, 0, len(childIDs)+1)
	args = append(args, entityType)
	for i, cid := range childIDs {
		placeholders[i] = "?"
		args = append(args, cid)
	}
	type row struct {
		EntityID int    `db:"entity_id"`
		TagID    int    `db:"id"`
		Name     string `db:"name"`
		Color    string `db:"color"`
	}
	var rows []row
	query := fmt.Sprintf(`
		SELECT et.entity_id, t.id, t.name, t.color
		FROM entry_tags et
		JOIN tags t ON t.id = et.tag_id
		JOIN %s src ON src.id = et.entity_id
		WHERE et.entity_type = ? AND src.child_id IN (%s)
		ORDER BY et.entity_id, t.name`, table, strings.Join(placeholders, ","))
	if err := db.Select(&rows, database.Q(db, query), args...); err != nil {
		return nil, err
	}
	out := map[int][]Tag{}
	for _, r := range rows {
		out[r.EntityID] = append(out[r.EntityID], Tag{ID: r.TagID, Name: r.Name, Color: r.Color})
	}
	return out, nil
}

// EnsureEntityAccessible returns ErrForbidden unless the caller (by userID)
// has at least read access to the child that owns the given (entityType,
// entityID). Used by per-entity tag reads so an attacker can't enumerate tags
// on another family's records by guessing ids. Unknown entityTypes map to
// ErrForbidden — never "open by default".
func EnsureEntityAccessible(db *sqlx.DB, userID int, entityType string, entityID int) error {
	return checkEntityAccess(db, userID, entityType, entityID, false)
}

// EnsureEntityWritable is the write-level sibling of EnsureEntityAccessible.
// Used by per-entity tag writes (setEntityTags PUT) so caregivers can tag
// their own entries without needing admin rights. Tag management (create /
// rename / delete at /api/tags/) stays admin-gated separately.
func EnsureEntityWritable(db *sqlx.DB, userID int, entityType string, entityID int) error {
	return checkEntityAccess(db, userID, entityType, entityID, true)
}

func checkEntityAccess(db *sqlx.DB, userID int, entityType string, entityID int, needWrite bool) error {
	table, ok := TagEntityTypeToTable[entityType]
	if !ok {
		return ErrForbidden
	}
	feature, ok := childOwnedTables[table]
	if !ok {
		return ErrForbidden
	}
	var childID int
	err := db.Get(&childID, database.Q(db, fmt.Sprintf("SELECT child_id FROM %s WHERE id = ?", table)), entityID)
	if err != nil {
		// Includes sql.ErrNoRows — don't leak existence via a distinct code.
		return ErrForbidden
	}
	level := CheckAccess(db, userID, childID, feature)
	if level == "none" {
		return ErrForbidden
	}
	if needWrite && level != "write" {
		return ErrForbidden
	}
	return nil
}

func GetTagsForEntity(db *sqlx.DB, entityType string, entityID int) ([]Tag, error) {
	var tags []Tag
	err := db.Select(&tags,
		database.Q(db, `SELECT t.* FROM tags t
		 JOIN entry_tags et ON et.tag_id = t.id
		 WHERE et.entity_type = ? AND et.entity_id = ?
		 ORDER BY t.name`),
		entityType, entityID,
	)
	if err != nil {
		return nil, err
	}
	if tags == nil {
		tags = []Tag{}
	}
	return tags, nil
}

func SetEntityTags(db *sqlx.DB, entityType string, entityID int, tagIDs []int) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(tx.Rebind(`DELETE FROM entry_tags WHERE entity_type = ? AND entity_id = ?`), entityType, entityID)
	if err != nil {
		return err
	}

	for _, tagID := range tagIDs {
		_, err = tx.Exec(
			tx.Rebind(`INSERT INTO entry_tags (tag_id, entity_type, entity_id) VALUES (?, ?, ?)`),
			tagID, entityType, entityID,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}
