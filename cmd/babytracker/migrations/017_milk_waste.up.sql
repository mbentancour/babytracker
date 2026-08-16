-- Uneaten milk: expressed milk that was prepared but poured away.
--
-- This exists so the estimated milk-stock figure can balance. Thaw 120 mL, the
-- baby drinks 90, and the 30 mL discarded has to come off the stash — but
-- logging it as a feeding would inflate intake, and adding it to the feeding's
-- own amount would do the same. It gets its own row precisely so it can be
-- subtracted without ever being counted as a feed.
--
-- Deliberately leaner than the other entry types: no photo column and no tag
-- support. There is nothing to photograph in a bookkeeping row, and a photo
-- column would need matching entries in delete.go, the gallery scan, the
-- ServePhoto UNION and a partial index — all cost, no benefit.
CREATE TABLE milk_waste (
    id SERIAL PRIMARY KEY,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    time TIMESTAMPTZ NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Both access paths are child-scoped: the list endpoint filters by child and
-- orders by time, and the stock endpoint sums by child.
CREATE INDEX idx_milk_waste_child_time ON milk_waste(child_id, time);
