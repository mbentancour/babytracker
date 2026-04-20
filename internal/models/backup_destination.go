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
	"github.com/mbentancour/babytracker/internal/crypto"
)

// BackupDestinationType enumerates supported storage backends.
const (
	BackupTypeLocal  = "local"
	BackupTypeWebDAV = "webdav"
	BackupTypeS3     = "s3"
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
//
// Secret fields (Password, S3SecretAccessKey, S3AccessKeyID) are stored
// encrypted at rest via the `enc:v1:` envelope — see internal/crypto/secrets.go.
// The Config() / SetConfig() accessors handle this transparently; callers
// see plaintext after Config() and pass plaintext into SetConfig().
type BackupDestinationConfig struct {
	// Local
	Path string `json:"path,omitempty"`

	// WebDAV
	URL       string `json:"url,omitempty"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"` // encrypted at rest
	Directory string `json:"directory,omitempty"`

	// TLS verification mode for WebDAV. One of:
	//   ""        = default (strict chain validation against system roots)
	//   "pin"     = pin to PinnedCertPEM; reject any other cert
	//   "skip"    = no verification (LAN / self-signed fallback)
	TLSMode       string `json:"tls_mode,omitempty"`
	PinnedCertPEM string `json:"pinned_cert_pem,omitempty"`

	// S3 / S3-compatible (MinIO, R2, B2, Wasabi, etc.)
	S3Bucket          string `json:"s3_bucket,omitempty"`
	S3Region          string `json:"s3_region,omitempty"`
	S3Prefix          string `json:"s3_prefix,omitempty"` // key prefix within the bucket
	S3AccessKeyID     string `json:"s3_access_key_id,omitempty"`
	S3SecretAccessKey string `json:"s3_secret_access_key,omitempty"` // encrypted at rest
	// S3EndpointURL overrides the AWS endpoint for S3-compatible services.
	// Leave empty for AWS. For MinIO use e.g. "https://minio.internal:9000".
	S3EndpointURL string `json:"s3_endpoint_url,omitempty"`
	// S3UsePathStyle forces path-style addressing (bucket.s3.example.com vs
	// s3.example.com/bucket). Required for most S3-compatible services.
	S3UsePathStyle bool `json:"s3_use_path_style,omitempty"`

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
	if err := json.Unmarshal(d.ConfigJSON, &c); err != nil {
		return c, err
	}
	decryptSecretFields(&c)
	return c, nil
}

func (d *BackupDestination) SetConfig(c BackupDestinationConfig) error {
	encryptSecretFields(&c)
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	d.ConfigJSON = b
	return nil
}

// decryptSecretFields turns every enc:v1:-wrapped value back into plaintext.
// Legacy plaintext values (pre-upgrade) pass through untouched.
func decryptSecretFields(c *BackupDestinationConfig) {
	c.Password = crypto.DecryptSecret(c.Password)
	c.S3AccessKeyID = crypto.DecryptSecret(c.S3AccessKeyID)
	c.S3SecretAccessKey = crypto.DecryptSecret(c.S3SecretAccessKey)
}

// encryptSecretFields wraps every secret value in the enc:v1: envelope.
// Already-encrypted values are a no-op so load/modify/save doesn't double-wrap.
func encryptSecretFields(c *BackupDestinationConfig) {
	c.Password = crypto.EncryptSecret(c.Password)
	c.S3AccessKeyID = crypto.EncryptSecret(c.S3AccessKeyID)
	c.S3SecretAccessKey = crypto.EncryptSecret(c.S3SecretAccessKey)
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
	case BackupTypeS3:
		pub["s3_bucket"] = c.S3Bucket
		pub["s3_region"] = c.S3Region
		pub["s3_prefix"] = c.S3Prefix
		pub["s3_endpoint_url"] = c.S3EndpointURL
		pub["s3_use_path_style"] = c.S3UsePathStyle
		pub["s3_access_key_id_set"] = c.S3AccessKeyID != ""
		pub["s3_secret_access_key_set"] = c.S3SecretAccessKey != ""
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
	err := db.Get(&d, `SELECT * FROM backup_destinations WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func CreateBackupDestination(db *sqlx.DB, d *BackupDestination) error {
	return db.QueryRowx(
		`INSERT INTO backup_destinations (name, type, config, retention_count, auto_backup, enabled, schedule)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
		d.Name, d.Type, d.ConfigJSON, d.RetentionCount, d.AutoBackup, d.Enabled, d.Schedule,
	).StructScan(d)
}

func UpdateBackupDestination(db *sqlx.DB, id int, updates map[string]any) (*BackupDestination, error) {
	query, args := buildUpdateQuery("backup_destinations", id, updates)
	var d BackupDestination
	err := db.QueryRowx(query, args...).StructScan(&d)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func DeleteBackupDestination(db *sqlx.DB, id int) error {
	_, err := db.Exec(`DELETE FROM backup_destinations WHERE id = $1`, id)
	return err
}
