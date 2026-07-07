-- Recreate the reminders table (reverse of the drop). Mirrors the original
-- definition from 002_extended_features.
CREATE TABLE reminders (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'interval'
        CHECK (type IN ('interval', 'fixed_time')),
    interval_minutes INTEGER,
    fixed_time TIME,
    days_of_week TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reminders_child_active ON reminders(child_id, active);
