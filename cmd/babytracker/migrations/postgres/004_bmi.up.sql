CREATE TABLE bmi (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    bmi DOUBLE PRECISION NOT NULL,
    notes TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bmi_child_date ON bmi(child_id, date);
