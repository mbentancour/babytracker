package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

// MilkWaste is expressed milk that was prepared but poured away. It is not a
// feeding — it never counts as intake — but it does leave the stash, so the
// milk-stock figure has to subtract it. See migration 017.
type MilkWaste struct {
	ID        int       `db:"id" json:"id"`
	ChildID   int       `db:"child_id" json:"child"`
	Time      time.Time `db:"time" json:"time"`
	Amount    float64   `db:"amount" json:"amount"`
	Notes     string    `db:"notes" json:"notes"`
	CreatedAt time.Time `db:"created_at" json:"-"`
}

type MilkWasteInput struct {
	Child  int     `json:"child"`
	Time   string  `json:"time"`
	Amount float64 `json:"amount"`
	Notes  string  `json:"notes"`
}

func CreateMilkWaste(db *sqlx.DB, m *MilkWaste) error {
	return db.QueryRowx(
		`INSERT INTO milk_waste (child_id, time, amount, notes)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		m.ChildID, m.Time, m.Amount, m.Notes,
	).StructScan(m)
}

func UpdateMilkWaste(db *sqlx.DB, id int, updates map[string]any) (*MilkWaste, error) {
	query, args := buildUpdateQuery("milk_waste", id, updates)
	var m MilkWaste
	err := db.QueryRowx(query, args...).StructScan(&m)
	return &m, err
}

// MilkStock is the running balance of expressed milk for one child, over all
// time. Per-period figures would be meaningless here: a stash is cumulative,
// so "how much is in the freezer" has to count every session ever logged.
type MilkStock struct {
	Pumped    float64 `db:"pumped" json:"pumped"`
	BottleFed float64 `db:"bottle_fed" json:"bottle_fed"`
	Discarded float64 `db:"discarded" json:"discarded"`
	Stock     float64 `json:"stock"`
}

// GetMilkStock computes pumped − bottle-fed − discarded for a child.
//
// Only *bottle* feeds of expressed milk are subtracted: nursing at the breast
// never touches the stash, and formula never came from it. Fortified breast
// milk counts because the base of it is expressed milk that was thawed.
//
// The figure is an estimate and the UI says so — it only balances if every
// pumping session and every bottle is logged with an amount. A negative result
// is meaningful information (something isn't being logged), not an error, so
// it is returned as-is rather than clamped.
func GetMilkStock(db *sqlx.DB, childID int) (*MilkStock, error) {
	const query = `
		SELECT
			COALESCE((SELECT SUM(amount) FROM pumping WHERE child_id = $1), 0) AS pumped,
			COALESCE((SELECT SUM(amount) FROM feedings
			          WHERE child_id = $1
			            AND method = 'bottle'
			            AND type IN ('breast milk', 'fortified breast milk')), 0) AS bottle_fed,
			COALESCE((SELECT SUM(amount) FROM milk_waste WHERE child_id = $1), 0) AS discarded`

	var s MilkStock
	if err := db.Get(&s, query, childID); err != nil {
		return nil, err
	}
	s.Stock = s.Pumped - s.BottleFed - s.Discarded
	return &s, nil
}
