package models

import (
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Timer struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Name      string    `db:"name" json:"name"`
	Start     time.Time `db:"start_time" json:"start"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type TimerInput struct {
	Child int    `json:"child"`
	Name  string `json:"name"`
	Start string `json:"start"`
}

func ListTimers(db *sqlx.DB) ([]Timer, error) {
	var timers []Timer
	err := db.Select(&timers, `SELECT * FROM timers ORDER BY start_time DESC`)
	if err != nil {
		return nil, err
	}
	if timers == nil {
		timers = []Timer{}
	}
	return timers, nil
}

// ListTimersForChildren returns timers whose child_id is in the supplied set.
// Empty slice → empty result (no rows), matching the pagination filter's
// "no access = no data" contract. Used by the handler to scope the list to
// the caller's accessible children.
func ListTimersForChildren(db *sqlx.DB, childIDs []int) ([]Timer, error) {
	if len(childIDs) == 0 {
		return []Timer{}, nil
	}
	placeholders := make([]string, len(childIDs))
	args := make([]any, len(childIDs))
	for i, id := range childIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	query := "SELECT * FROM timers WHERE child_id IN (" + strings.Join(placeholders, ",") + ") ORDER BY start_time DESC"
	var timers []Timer
	if err := db.Select(&timers, database.Q(db, query), args...); err != nil {
		return nil, err
	}
	if timers == nil {
		timers = []Timer{}
	}
	return timers, nil
}

func CreateTimer(db *sqlx.DB, t *Timer) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO timers (child_id, name, start_time)
		 VALUES (?, ?, ?) RETURNING *`),
		t.ChildID, t.Name, t.Start,
	).StructScan(t)
}

func GetTimer(db *sqlx.DB, id int) (*Timer, error) {
	var t Timer
	err := db.Get(&t, database.Q(db, `SELECT * FROM timers WHERE id = ?`), id)
	return &t, err
}

func UpdateTimer(db *sqlx.DB, id int, updates map[string]any) (*Timer, error) {
	query, args := buildUpdateQuery("timers", id, updates)
	var t Timer
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&t)
	return &t, err
}

func DeleteTimer(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM timers WHERE id = ?`), id)
	return err
}
