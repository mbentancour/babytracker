package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Reminder struct {
	ID              int        `db:"id" json:"id"`
	ChildID         int        `db:"child_id" json:"child"`
	Title           string     `db:"title" json:"title"`
	Type            string     `db:"type" json:"type"`
	IntervalMinutes *int       `db:"interval_minutes" json:"interval_minutes"`
	FixedTime       *string    `db:"fixed_time" json:"fixed_time"`
	DaysOfWeek      string     `db:"days_of_week" json:"days_of_week"`
	Active          bool       `db:"active" json:"active"`
	LastTriggeredAt *time.Time `db:"last_triggered_at" json:"last_triggered_at"`
	CreatedAt       time.Time  `db:"created_at" json:"-"`
}

type ReminderInput struct {
	Child           int    `json:"child"`
	Title           string `json:"title"`
	Type            string `json:"type"`
	IntervalMinutes *int   `json:"interval_minutes"`
	FixedTime       *string `json:"fixed_time"`
	DaysOfWeek      string `json:"days_of_week"`
	Active          *bool  `json:"active"`
}

func ListReminders(db *sqlx.DB, childID int) ([]Reminder, error) {
	var reminders []Reminder
	err := db.Select(&reminders,
		`SELECT * FROM reminders WHERE child_id = $1 ORDER BY created_at DESC`,
		childID,
	)
	if err != nil {
		return nil, err
	}
	if reminders == nil {
		reminders = []Reminder{}
	}
	return reminders, nil
}

func CreateReminder(db *sqlx.DB, r *Reminder) error {
	if r.Type == "" {
		r.Type = "interval"
	}
	return db.QueryRowx(
		`INSERT INTO reminders (child_id, title, type, interval_minutes, fixed_time, days_of_week, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
		r.ChildID, r.Title, r.Type, r.IntervalMinutes, r.FixedTime, r.DaysOfWeek, r.Active,
	).StructScan(r)
}

func UpdateReminder(db *sqlx.DB, id int, updates map[string]any) (*Reminder, error) {
	query, args := buildUpdateQuery("reminders", id, updates)
	var r Reminder
	err := db.QueryRowx(query, args...).StructScan(&r)
	return &r, err
}

func DeleteReminder(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM reminders WHERE id = $1`, id)
	return err
}

func GetActiveReminders(db *sqlx.DB) ([]Reminder, error) {
	var reminders []Reminder
	err := db.Select(&reminders, `SELECT * FROM reminders WHERE active = TRUE`)
	if err != nil {
		return nil, err
	}
	if reminders == nil {
		reminders = []Reminder{}
	}
	return reminders, nil
}

func UpdateReminderTriggered(db *sqlx.DB, id int) error {
	_, err := db.Exec(`UPDATE reminders SET last_triggered_at = NOW() WHERE id = $1`, id)
	return err
}
