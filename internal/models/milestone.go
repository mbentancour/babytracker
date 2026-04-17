package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Milestone struct {
	ID          int       `db:"id" json:"id"`
	ChildID     int       `db:"child_id" json:"child"`
	Date        string    `db:"date" json:"date"`
	Title       string    `db:"title" json:"title"`
	Category    string    `db:"category" json:"category"`
	Description string    `db:"description" json:"description"`
	Photo       string    `db:"photo" json:"photo"`
	CreatedAt   time.Time `db:"created_at" json:"-"`
}

type MilestoneInput struct {
	Child       int    `json:"child"`
	Date        string `json:"date"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

func CreateMilestone(db *sqlx.DB, m *Milestone) error {
	if m.Category == "" {
		m.Category = "other"
	}
	return db.QueryRowx(
		database.Q(db, `INSERT INTO milestones (child_id, date, title, category, description, photo)
		 VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
		m.ChildID, m.Date, m.Title, m.Category, m.Description, m.Photo,
	).StructScan(m)
}

func UpdateMilestone(db *sqlx.DB, id int, updates map[string]any) (*Milestone, error) {
	query, args := buildUpdateQuery("milestones", id, updates)
	var m Milestone
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&m)
	return &m, err
}

func DeleteMilestone(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM milestones WHERE id = ?`), id)
	return err
}
