package models

import (
	"time"

	"github.com/jmoiron/sqlx"
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
		`INSERT INTO pumping (child_id, start_time, end_time, amount)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		p.ChildID, p.Start, p.End, p.Amount,
	).StructScan(p)
}

func UpdatePumping(db *sqlx.DB, id int, updates map[string]any) (*Pumping, error) {
	query, args := buildUpdateQuery("pumping", id, updates)
	var p Pumping
	err := db.QueryRowx(query, args...).StructScan(&p)
	return &p, err
}
