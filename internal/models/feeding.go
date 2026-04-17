package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Feeding struct {
	ID        int        `db:"id" json:"id"`
	ChildID   int        `db:"child_id" json:"child"`
	Start     time.Time  `db:"start_time" json:"start"`
	End       time.Time  `db:"end_time" json:"end"`
	Type      string     `db:"type" json:"type"`
	Method    string     `db:"method" json:"method"`
	Amount    *float64   `db:"amount" json:"amount"`
	Duration  *string    `db:"duration" json:"duration"`
	Notes     string     `db:"notes" json:"notes"`
	TimerID   *int       `db:"timer_id" json:"timer"`
	Photo     string     `db:"photo" json:"photo"`
	CreatedAt time.Time  `db:"created_at" json:"-"`
}

type FeedingInput struct {
	Child  int      `json:"child"`
	Start  string   `json:"start"`
	End    string   `json:"end"`
	Type   string   `json:"type"`
	Method string   `json:"method"`
	Amount *float64 `json:"amount"`
	Notes  string   `json:"notes"`
	Timer  *int     `json:"timer"`
}

func CreateFeeding(db *sqlx.DB, f *Feeding) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO feedings (child_id, start_time, end_time, type, method, amount, duration, notes, timer_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
		f.ChildID, f.Start, f.End, f.Type, f.Method, f.Amount,
		computeInterval(f.Start, f.End), f.Notes, f.TimerID,
	).StructScan(f)
}

func UpdateFeeding(db *sqlx.DB, id int, updates map[string]any) (*Feeding, error) {
	query, args := buildUpdateQuery("feedings", id, updates)
	var f Feeding
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&f)
	return &f, err
}

func computeInterval(start, end time.Time) string {
	d := end.Sub(start)
	if d < 0 {
		d = 0
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	return FormatDuration(h*3600 + m*60 + s)
}
