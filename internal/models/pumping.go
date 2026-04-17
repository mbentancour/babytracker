package models

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Pumping struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Start     time.Time `db:"start_time" json:"start"`
	End       time.Time `db:"end_time" json:"end"`
	Amount    *float64  `db:"amount" json:"amount"`
	Duration  *string   `db:"duration" json:"duration"`
	Photo     string    `db:"photo" json:"photo"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type PumpingInput struct {
	Child  int      `json:"child"`
	Start  string   `json:"start"`
	End    string   `json:"end"`
	Amount *float64 `json:"amount"`
}

func CreatePumping(db *sqlx.DB, p *Pumping) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO pumping (child_id, start_time, end_time, amount, duration)
		 VALUES (?, ?, ?, ?, ?) RETURNING *`),
		p.ChildID, p.Start, p.End, p.Amount, computeInterval(p.Start, p.End),
	).StructScan(p)
}
