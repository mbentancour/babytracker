package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Medication struct {
	ID         int       `db:"id" json:"id"`
	ChildID    int       `db:"child_id" json:"child"`
	Time       time.Time `db:"time" json:"time"`
	Name       string    `db:"name" json:"name"`
	Dosage     string    `db:"dosage" json:"dosage"`
	DosageUnit string    `db:"dosage_unit" json:"dosage_unit"`
	Notes      string    `db:"notes" json:"notes"`
	Photo      string    `db:"photo" json:"photo"`
	CreatedAt  time.Time `db:"created_at" json:"-"`
}

type MedicationInput struct {
	Child      int    `json:"child"`
	Time       string `json:"time"`
	Name       string `json:"name"`
	Dosage     string `json:"dosage"`
	DosageUnit string `json:"dosage_unit"`
	Notes      string `json:"notes"`
}

func CreateMedication(db *sqlx.DB, m *Medication) error {
	return db.QueryRowx(
		`INSERT INTO medications (child_id, time, name, dosage, dosage_unit, notes)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
		m.ChildID, m.Time, m.Name, m.Dosage, m.DosageUnit, m.Notes,
	).StructScan(m)
}

func UpdateMedication(db *sqlx.DB, id int, updates map[string]any) (*Medication, error) {
	query, args := buildUpdateQuery("medications", id, updates)
	var m Medication
	err := db.QueryRowx(query, args...).StructScan(&m)
	return &m, err
}

func DeleteMedication(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM medications WHERE id = $1`, id)
	return err
}
