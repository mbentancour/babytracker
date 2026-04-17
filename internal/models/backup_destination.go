package models

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

// BackupDestinationType enumerates supported storage backends.
const (
	BackupTypeLocal  = "local"
	BackupTypeWebDAV = "webdav"
)

// BackupDestination maps to the backup_destinations table.
// `Config` and `Encryption` live inside the JSONB `config` column but we
// split them on the Go side for clarity.
type BackupDestination struct {
	ID             int            `db:"id" json:"id"`
	Name           string         `db:"name" json:"name"`
	Type           string         `db:"type" json:"type"`
	ConfigJSON     []byte         `db:"config" json:"-"`
	RetentionCount int            `db:"retention_count" json:"retention_count"`
	AutoBackup     bool           `db:"auto_backup" json:"auto_backup"`
	Enabled        bool           `db:"enabled" json:"enabled"`
	// Schedule is a 5-field cron expression (minute hour dom month dow). An
	// empty string means "never automatically". Evaluated by the scheduler in
	// the server's local timezone.
	Schedule       string         `db:"schedule" json:"schedule"`
	CreatedAt      time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time      `db:"updated_at" json:"updated_at"`
}

// Config is the decoded representation of the `config` JSONB column.
// Fields are present or absent depending on Type; unused ones are omitted.
type BackupDestinationConfig struct {
	// Local
	Path string `json:"path,omitempty"`

	// WebDAV
	URL       string `json:"url,omitempty"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
	Directory string `json:"directory,omitempty"`

	// TLS verification mode for WebDAV. One of:
	//   ""        = default (strict chain validation against system roots)
	//   "pin"     = pin to PinnedCertPEM; reject any other cert
	//   "skip"    = no verification (LAN / self-signed fallback)
	TLSMode       string `json:"tls_mode,omitempty"`
	PinnedCertPEM string `json:"pinned_cert_pem,omitempty"`

	// Shared — encryption parameters. Absent = not encrypted.
	Encryption *EncryptionConfig `json:"encryption,omitempty"`
}

// EncryptionConfig is stored per-destination.
// `Passphrase` is optional — when nil, the user must supply it per-backup.
// When set, scheduled backups can encrypt on the user's behalf (with a clear
// UI warning that this weakens protection against server compromise).
type EncryptionConfig struct {
	SaltB64     string  `json:"salt_b64"`
	VerifierB64 string  `json:"verifier_b64"`
	Passphrase  *string `json:"passphrase,omitempty"`
}

func (d *BackupDestination) Config() (BackupDestinationConfig, error) {
	var c BackupDestinationConfig
	if len(d.ConfigJSON) == 0 {
		return c, nil
	}
	err := json.Unmarshal(d.ConfigJSON, &c)
	return c, err
}

func (d *BackupDestination) SetConfig(c BackupDestinationConfig) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	d.ConfigJSON = b
	return nil
}

// PublicConfig returns a config safe to expose via the API — passwords and
// stored passphrases are masked so they don't leak via GET responses.
func (d *BackupDestination) PublicConfig() (map[string]any, error) {
	c, err := d.Config()
	if err != nil {
		return nil, err
	}
	pub := map[string]any{}
	switch d.Type {
	case BackupTypeLocal:
		pub["path"] = c.Path
	case BackupTypeWebDAV:
		pub["url"] = c.URL
		pub["username"] = c.Username
		pub["directory"] = c.Directory
		pub["password_set"] = c.Password != ""
		// Expose the TLS mode and — when a cert is pinned — enough metadata
		// to render in the UI without shipping the full PEM. Fingerprint
		// lets the user sanity-check which cert is pinned; NotAfter drives
		// the "expiring soon" banner in the destinations list.
		mode := c.TLSMode
		if mode == "" {
			mode = "strict"
		}
		tls := map[string]any{"mode": mode}
		if c.TLSMode == "pin" && c.PinnedCertPEM != "" {
			if fp, notAfter, subject, err := parsePinnedCert(c.PinnedCertPEM); err == nil {
				tls["fingerprint"] = fp
				tls["not_after"] = notAfter
				tls["subject"] = subject
			}
		}
		pub["tls"] = tls
	}
	if c.Encryption != nil {
		pub["encryption"] = map[string]any{
			"enabled":          true,
			"passphrase_saved": c.Encryption.Passphrase != nil && *c.Encryption.Passphrase != "",
		}
	} else {
		pub["encryption"] = map[string]any{"enabled": false}
	}
	return pub, nil
}

// parsePinnedCert extracts the display metadata for a PEM-encoded certificate.
// Used by the public config serializer to show fingerprint + expiry without
// shipping the raw PEM to the client.
func parsePinnedCert(pemStr string) (fingerprint, notAfter, subject string, err error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return "", "", "", pemDecodeErr
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", "", "", err
	}
	sum := sha256.Sum256(cert.Raw)
	fp := hex.EncodeToString(sum[:])
	// Colon-separate for readability: "AB:CD:EF:…".
	pairs := make([]string, 0, len(sum))
	for i := 0; i < len(sum); i++ {
		pairs = append(pairs, fp[i*2:i*2+2])
	}
	return strings.ToUpper(strings.Join(pairs, ":")), cert.NotAfter.UTC().Format(time.RFC3339), cert.Subject.String(), nil
}

var pemDecodeErr = &pemError{"not a valid PEM block"}

type pemError struct{ msg string }

func (e *pemError) Error() string { return e.msg }

func ListBackupDestinations(db *sqlx.DB) ([]BackupDestination, error) {
	var rows []BackupDestination
	err := db.Select(&rows,
		`SELECT * FROM backup_destinations ORDER BY id`)
	return rows, err
}

func GetBackupDestination(db *sqlx.DB, id int) (*BackupDestination, error) {
	var d BackupDestination
	err := db.Get(&d, database.Q(db, `SELECT * FROM backup_destinations WHERE id = ?`), id)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func CreateBackupDestination(db *sqlx.DB, d *BackupDestination) error {
	return db.QueryRowx(
		database.Q(db, `INSERT INTO backup_destinations (name, type, config, retention_count, auto_backup, enabled, schedule)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
		d.Name, d.Type, d.ConfigJSON, d.RetentionCount, d.AutoBackup, d.Enabled, d.Schedule,
	).StructScan(d)
}

func UpdateBackupDestination(db *sqlx.DB, id int, updates map[string]any) (*BackupDestination, error) {
	query, args := buildUpdateQuery("backup_destinations", id, updates)
	var d BackupDestination
	err := db.QueryRowx(database.Q(db, query), args...).StructScan(&d)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func DeleteBackupDestination(db *sqlx.DB, id int) error {
	_, err := db.Exec(database.Q(db, `DELETE FROM backup_destinations WHERE id = ?`), id)
	return err
}
