-- Backup destinations: where backups are stored. Multiple destinations allowed,
-- each with its own config, retention, encryption, and auto-backup flag.
CREATE TABLE backup_destinations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('local', 'webdav')),
    config          TEXT NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 7 CHECK (retention_count >= 1),
    auto_backup     INTEGER NOT NULL DEFAULT 1,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    updated_at      TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

-- Seed the default local destination so existing installs keep working.
-- Empty path means "use the configured DATA_DIR/backups at runtime".
INSERT INTO backup_destinations (name, type, config)
VALUES ('Local', 'local', '{"path": ""}');
