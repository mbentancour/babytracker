package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type TummyTime struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Start     time.Time `db:"start_time" json:"start"`
	End       time.Time `db:"end_time" json:"end"`
	Duration  *string   `db:"duration" json:"duration"`
	Milestone string    `db:"milestone" json:"milestone"`
	Notes     string    `db:"notes" json:"notes"`
	TimerID   *int      `db:"timer_id" json:"timer"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type TummyTimeInput struct {
	Child     int    `json:"child"`
	Start     string `json:"start"`
	End       string `json:"end"`
	Milestone string `json:"milestone"`
	Notes     string `json:"notes"`
	Timer     *int   `json:"timer"`
}

func CreateTummyTime(db *sqlx.DB, t *TummyTime) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO tummy_times (child_id, start_time, end_time, duration, milestone, notes, timer_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
		t.ChildID, t.Start, t.End, computeInterval(t.Start, t.End), t.Milestone, t.Notes, t.TimerID,
	).StructScan(t)
}

func UpdateTummyTime(db *sqlx.DB, id int, updates map[string]any) (*TummyTime, error) {
	query, args := buildUpdateQuery("tummy_times", id, updates)
	var t TummyTime
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&t)
	return &t, err
}
