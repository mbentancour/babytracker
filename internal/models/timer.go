package models

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// TimerPause represents a pause period
type TimerPause struct {
	Start *time.Time `json:"start"`
	End   *time.Time `json:"end"`
}

type Timer struct {
	ID            int            `db:"id" json:"id"`
	ChildID       int            `db:"child_id" json:"child"`
	Name          string         `db:"name" json:"name"`
	Start         time.Time      `db:"start_time" json:"start"`
	IsPaused      bool           `db:"is_paused" json:"isPaused"`
	PausedElapsed int            `db:"paused_elapsed" json:"pausedElapsed"`
	PausesRaw     []byte         `db:"pauses" json:"-"`
	Pauses        []TimerPause   `json:"pauses"`
	CreatedAt     time.Time      `db:"created_at" json:"-"`
}

// UnmarshalPauses parses the JSON pauses data
func (t *Timer) UnmarshalPauses() error {
	if len(t.PausesRaw) == 0 || string(t.PausesRaw) == "[]" {
		t.Pauses = []TimerPause{}
		return nil
	}
	return json.Unmarshal(t.PausesRaw, &t.Pauses)
}

type TimerInput struct {
	Child int    `json:"child"`
	Name  string `json:"name"`
	Start string `json:"start"`
}

func ListTimers(db *sqlx.DB) ([]Timer, error) {
	var timers []Timer
	err := db.Select(&timers, `SELECT id, child_id, name, start_time, is_paused, paused_elapsed, COALESCE(pauses, '[]'::jsonb) as pauses, created_at FROM timers ORDER BY start_time DESC`)
	if err != nil {
		return nil, err
	}
	if timers == nil {
		timers = []Timer{}
	}
	// Unmarshal pauses for each timer
	for i := range timers {
		timers[i].UnmarshalPauses()
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
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(
		`SELECT id, child_id, name, start_time, is_paused, paused_elapsed, COALESCE(pauses, '[]'::jsonb) as pauses, created_at FROM timers WHERE child_id IN (%s) ORDER BY start_time DESC`,
		strings.Join(placeholders, ","))
	var timers []Timer
	if err := db.Select(&timers, query, args...); err != nil {
		return nil, err
	}
	if timers == nil {
		timers = []Timer{}
	}
	// Unmarshal pauses for each timer
	for i := range timers {
		timers[i].UnmarshalPauses()
	}
	return timers, nil
}

func CreateTimer(db *sqlx.DB, t *Timer) error {
	// Try with pauses column first, fall back to without if column doesn't exist
	err := db.QueryRowx(
		`INSERT INTO timers (child_id, name, start_time)
		 VALUES ($1, $2, $3) RETURNING id, child_id, name, start_time, is_paused, paused_elapsed, COALESCE(pauses, '[]'::jsonb) as pauses, created_at`,
		t.ChildID, t.Name, t.Start,
	).StructScan(t)
	if err != nil {
		return err
	}
	return t.UnmarshalPauses()
}

func GetTimer(db *sqlx.DB, id int) (*Timer, error) {
	var t Timer
	err := db.Get(&t, `SELECT id, child_id, name, start_time, is_paused, paused_elapsed, COALESCE(pauses, '[]'::jsonb) as pauses, created_at FROM timers WHERE id = $1`, id)
	if err != nil {
		return &t, err
	}
	return &t, t.UnmarshalPauses()
}

func UpdateTimer(db *sqlx.DB, id int, updates map[string]any) (*Timer, error) {
	query, args := buildUpdateQuery("timers", id, updates)
	var t Timer
	err := db.QueryRowx(query, args...).StructScan(&t)
	if err != nil {
		return &t, err
	}
	return &t, t.UnmarshalPauses()
}

func DeleteTimer(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM timers WHERE id = $1`, id)
	return err
}
