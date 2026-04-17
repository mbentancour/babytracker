package models

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
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
		database.Q(db, `SELECT * FROM reminders WHERE child_id = ? ORDER BY created_at DESC`),
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
		database.Q(db, `INSERT INTO reminders (child_id, title, type, interval_minutes, fixed_time, days_of_week, active)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
		r.ChildID, r.Title, r.Type, r.IntervalMinutes, r.FixedTime, r.DaysOfWeek, r.Active,
	).StructScan(r)
}

func UpdateReminder(db *sqlx.DB, id int, updates map[string]any) (*Reminder, error) {
	query, args := buildUpdateQuery("reminders", id, updates)
	var r Reminder
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&r)
	return &r, err
}

func DeleteReminder(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM reminders WHERE id = ?`), id)
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
	_, err := db.Exec(database.Q(db, fmt.Sprintf(`UPDATE reminders SET last_triggered_at = %s WHERE id = ?`, database.Now())), id)
	return err
}
