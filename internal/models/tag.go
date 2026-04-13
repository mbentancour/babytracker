package models

import (
	"time"

	"github.com/jmoiron/sqlx"
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
		`INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *`,
		t.Name, t.Color,
	).StructScan(t)
}

func UpdateTag(db *sqlx.DB, id int, updates map[string]any) (*Tag, error) {
	query, args := buildUpdateQuery("tags", id, updates)
	var t Tag
	err := db.QueryRowx(query, args...).StructScan(&t)
	return &t, err
}

func DeleteTag(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM tags WHERE id = $1`, id)
	return err
}

func GetTagsForEntity(db *sqlx.DB, entityType string, entityID int) ([]Tag, error) {
	var tags []Tag
	err := db.Select(&tags,
		`SELECT t.* FROM tags t
		 JOIN entry_tags et ON et.tag_id = t.id
		 WHERE et.entity_type = $1 AND et.entity_id = $2
		 ORDER BY t.name`,
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

	_, err = tx.Exec(`DELETE FROM entry_tags WHERE entity_type = $1 AND entity_id = $2`, entityType, entityID)
	if err != nil {
		return err
	}

	for _, tagID := range tagIDs {
		_, err = tx.Exec(
			`INSERT INTO entry_tags (tag_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
			tagID, entityType, entityID,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}
