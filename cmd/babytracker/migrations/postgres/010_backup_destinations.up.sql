-- Backup destinations: where backups are stored. Multiple destinations allowed,
-- each with its own config, retention, encryption, and auto-backup flag.
CREATE TABLE backup_destinations (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('local', 'webdav')),
    config          JSONB NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 7 CHECK (retention_count >= 1),
    auto_backup     BOOLEAN NOT NULL DEFAULT TRUE,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the default local destination so existing installs keep working.
-- Empty path means "use the configured DATA_DIR/backups at runtime".
INSERT INTO backup_destinations (name, type, config)
VALUES ('Local', 'local', '{"path": ""}');
