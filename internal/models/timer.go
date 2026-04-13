package models

import (
	"time"

	"github.com/jmoiron/sqlx"
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

func CreateTimer(db *sqlx.DB, t *Timer) error {
	return db.QueryRowx(
		`INSERT INTO timers (child_id, name, start_time)
		 VALUES ($1, $2, $3) RETURNING *`,
		t.ChildID, t.Name, t.Start,
	).StructScan(t)
}

func GetTimer(db *sqlx.DB, id int) (*Timer, error) {
	var t Timer
	err := db.Get(&t, `SELECT * FROM timers WHERE id = $1`, id)
	return &t, err
}

func UpdateTimer(db *sqlx.DB, id int, updates map[string]any) (*Timer, error) {
	query, args := buildUpdateQuery("timers", id, updates)
	var t Timer
	err := db.QueryRowx(query, args...).StructScan(&t)
	return &t, err
}

func DeleteTimer(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM timers WHERE id = $1`, id)
	return err
}
