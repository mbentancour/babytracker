package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Sleep struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Start     time.Time `db:"start_time" json:"start"`
	End       time.Time `db:"end_time" json:"end"`
	Duration  *string   `db:"duration" json:"duration"`
	Nap       bool      `db:"nap" json:"nap"`
	Notes     string    `db:"notes" json:"notes"`
	TimerID   *int      `db:"timer_id" json:"timer"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type SleepInput struct {
	Child int    `json:"child"`
	Start string `json:"start"`
	End   string `json:"end"`
	Nap   bool   `json:"nap"`
	Notes string `json:"notes"`
	Timer *int   `json:"timer"`
}

func CreateSleep(db *sqlx.DB, s *Sleep) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO sleep (child_id, start_time, end_time, duration, nap, notes, timer_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
		s.ChildID, s.Start, s.End, computeInterval(s.Start, s.End), s.Nap, s.Notes, s.TimerID,
	).StructScan(s)
}

func UpdateSleep(db *sqlx.DB, id int, updates map[string]any) (*Sleep, error) {
	query, args := buildUpdateQuery("sleep", id, updates)
	var s Sleep
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&s)
	return &s, err
}
