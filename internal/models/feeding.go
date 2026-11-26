package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Feeding struct {
	ID       int       `db:"id" json:"id"`
	ChildID  int       `db:"child_id" json:"child"`
	Start    time.Time `db:"start_time" json:"start"`
	End      time.Time `db:"end_time" json:"end"`
	Type     string    `db:"type" json:"type"`
	Method   string    `db:"method" json:"method"`
	Amount   *float64  `db:"amount" json:"amount"`
	Duration *string   `db:"duration" json:"duration"`
	// Seconds the source timer spent paused; duration excludes them.
	PausedSeconds int `db:"paused_seconds" json:"paused_seconds"`
	// How long each side took in a feed on both breasts, when that was said.
	// Kept for that method only.
	LeftSeconds  *int      `db:"left_seconds" json:"left_seconds"`
	RightSeconds *int      `db:"right_seconds" json:"right_seconds"`
	Notes        string    `db:"notes" json:"notes"`
	TimerID      *int      `db:"timer_id" json:"timer"`
	Photo        string    `db:"photo" json:"photo"`
	CreatedAt    time.Time `db:"created_at" json:"-"`
}

type FeedingInput struct {
	Child        int      `json:"child"`
	Start        string   `json:"start"`
	End          string   `json:"end"`
	Type         string   `json:"type"`
	Method       string   `json:"method"`
	Amount       *float64 `json:"amount"`
	LeftSeconds  *int     `json:"left_seconds"`
	RightSeconds *int     `json:"right_seconds"`
	Notes        string   `json:"notes"`
	Timer        *int     `json:"timer"`
}

func CreateFeeding(db *sqlx.DB, f *Feeding) error {
	return db.QueryRowx(
		`INSERT INTO feedings (child_id, start_time, end_time, paused_seconds, type, method, amount, left_seconds, right_seconds, notes, timer_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
		f.ChildID, f.Start, f.End, f.PausedSeconds, f.Type, f.Method, f.Amount, f.LeftSeconds, f.RightSeconds, f.Notes, f.TimerID,
	).StructScan(f)
}

func UpdateFeeding(db *sqlx.DB, id int, updates map[string]any) (*Feeding, error) {
	query, args := buildUpdateQuery("feedings", id, updates)
	var f Feeding
	err := db.QueryRowx(query, args...).StructScan(&f)
	return &f, err
}
