-- Entries created from a paused timer keep their real end_time and record
-- the paused time separately, so "ended at" stays truthful while duration
-- (generated, see 014) excludes the pauses. A generated column's expression
-- can't be altered in place, so duration is dropped and re-added.

ALTER TABLE feedings ADD COLUMN paused_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedings DROP COLUMN duration;
ALTER TABLE feedings ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time - paused_seconds * INTERVAL '1 second', INTERVAL '0')) STORED;

ALTER TABLE sleep ADD COLUMN paused_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sleep DROP COLUMN duration;
ALTER TABLE sleep ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time - paused_seconds * INTERVAL '1 second', INTERVAL '0')) STORED;

ALTER TABLE tummy_times ADD COLUMN paused_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tummy_times DROP COLUMN duration;
ALTER TABLE tummy_times ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time - paused_seconds * INTERVAL '1 second', INTERVAL '0')) STORED;
