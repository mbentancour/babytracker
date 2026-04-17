-- Head circumference tracking
CREATE TABLE head_circumference (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    head_circumference DOUBLE PRECISION NOT NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_head_circumference_child_date ON head_circumference(child_id, date);

-- Tags system
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6C5CE7',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entry_tags (
    id SERIAL PRIMARY KEY,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tag_id, entity_type, entity_id)
);
CREATE INDEX idx_entry_tags_entity ON entry_tags(entity_type, entity_id);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

-- Medication/vitamin tracking
CREATE TABLE medications (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    time TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    dosage TEXT DEFAULT '',
    dosage_unit TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_medications_child_time ON medications(child_id, time);

-- Milestone tracking
CREATE TABLE milestones (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other'
        CHECK (category IN ('motor', 'cognitive', 'social', 'language', 'other')),
    description TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_milestones_child_date ON milestones(child_id, date);

-- Reminders/notifications
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

-- API tokens for external integrations
CREATE TABLE api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    permissions TEXT DEFAULT 'read',
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- Webhooks for external tool integration
CREATE TABLE webhooks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT DEFAULT '',
    events TEXT NOT NULL DEFAULT '*',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    last_status_code INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhooks_active ON webhooks(active);

-- Add head_circumference to pagination allowed order fields
-- (handled in Go code, not SQL)
