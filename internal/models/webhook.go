package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type Webhook struct {
	ID              int        `db:"id" json:"id"`
	UserID          int        `db:"user_id" json:"user_id"`
	Name            string     `db:"name" json:"name"`
	URL             string     `db:"url" json:"url"`
	Secret          string     `db:"secret" json:"-"`
	Events          string     `db:"events" json:"events"`
	Active          bool       `db:"active" json:"active"`
	LastTriggeredAt *time.Time `db:"last_triggered_at" json:"last_triggered_at"`
	LastStatusCode  *int       `db:"last_status_code" json:"last_status_code"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
}

type WebhookInput struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Secret string `json:"secret"`
	Events string `json:"events"`
	Active *bool  `json:"active"`
}

func ListWebhooks(db *sqlx.DB, userID int) ([]Webhook, error) {
	var webhooks []Webhook
	err := db.Select(&webhooks,
		`SELECT * FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	if webhooks == nil {
		webhooks = []Webhook{}
	}
	return webhooks, nil
}

func CreateWebhook(db *sqlx.DB, w *Webhook) error {
	return db.QueryRowx(
		`INSERT INTO webhooks (user_id, name, url, secret, events, active)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
		w.UserID, w.Name, w.URL, w.Secret, w.Events, w.Active,
	).StructScan(w)
}

func UpdateWebhook(db *sqlx.DB, id int, userID int, updates map[string]any) (*Webhook, error) {
	// Add user_id check to the WHERE clause for safety
	updates["user_id"] = userID
	query, args := buildUpdateQueryWithExtraCondition("webhooks", id, updates, "user_id")
	var w Webhook
	err := db.QueryRowx(query, args...).StructScan(&w)
	return &w, err
}

func DeleteWebhook(db *sqlx.DB, id int, userID int) error {
	_, err := db.Exec(`DELETE FROM webhooks WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func GetActiveWebhooksForEvent(db *sqlx.DB, event string) ([]Webhook, error) {
	var webhooks []Webhook
	err := db.Select(&webhooks,
		`SELECT * FROM webhooks WHERE active = TRUE AND (events = '*' OR events LIKE '%' || $1 || '%')`,
		event,
	)
	if err != nil {
		return nil, err
	}
	if webhooks == nil {
		webhooks = []Webhook{}
	}
	return webhooks, nil
}

func UpdateWebhookStatus(db *sqlx.DB, id int, statusCode int) error {
	_, err := db.Exec(
		`UPDATE webhooks SET last_triggered_at = NOW(), last_status_code = $1 WHERE id = $2`,
		statusCode, id,
	)
	return err
}
