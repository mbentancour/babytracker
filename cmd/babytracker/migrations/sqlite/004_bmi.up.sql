CREATE TABLE bmi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    bmi REAL NOT NULL,
    notes TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bmi_child_date ON bmi(child_id, date);
