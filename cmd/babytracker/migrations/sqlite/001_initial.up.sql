CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    updated_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    birth_date TEXT NOT NULL,
    picture TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    updated_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE feedings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    type TEXT NOT NULL DEFAULT 'breast milk'
        CHECK (type IN ('breast milk', 'formula', 'fortified breast milk', 'solid food')),
    method TEXT NOT NULL DEFAULT 'bottle'
        CHECK (method IN ('bottle', 'left breast', 'right breast', 'both breasts', 'parent fed', 'self fed')),
    amount REAL,
    duration TEXT,
    notes TEXT DEFAULT '',
    timer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sleep (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration TEXT,
    nap INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    timer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    time TIMESTAMP NOT NULL,
    wet INTEGER NOT NULL DEFAULT 0,
    solid INTEGER NOT NULL DEFAULT 0,
    color TEXT DEFAULT ''
        CHECK (color IN ('', 'black', 'brown', 'green', 'yellow')),
    amount REAL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tummy_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration TEXT,
    milestone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    timer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE temperature (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    time TIMESTAMP NOT NULL,
    temperature REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE weight (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    weight REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE height (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    height REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pumping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    amount REAL,
    duration TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    time TIMESTAMP NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    name TEXT DEFAULT '',
    start_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT,
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_feedings_child_start ON feedings(child_id, start_time);
CREATE INDEX idx_sleep_child_start ON sleep(child_id, start_time);
CREATE INDEX idx_changes_child_time ON changes(child_id, time);
CREATE INDEX idx_tummy_times_child_start ON tummy_times(child_id, start_time);
CREATE INDEX idx_temperature_child_time ON temperature(child_id, time);
CREATE INDEX idx_weight_child_date ON weight(child_id, date);
CREATE INDEX idx_height_child_date ON height(child_id, date);
CREATE INDEX idx_notes_child_time ON notes(child_id, time);
CREATE INDEX idx_timers_child ON timers(child_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
