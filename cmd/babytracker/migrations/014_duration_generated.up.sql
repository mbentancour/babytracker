-- Make `duration` a generated column derived from end_time - start_time.
-- The old plain INTERVAL column was only written on INSERT, so editing an
-- entry's start/end via PATCH left a stale duration behind that disagreed
-- with the new times. GENERATED ALWAYS keeps them in sync; recomputing on
-- column add also corrects all existing stale rows in one shot.
--
-- GREATEST(..., '0') preserves the prior clamp from computeInterval() for
-- malformed rows where end < start.

ALTER TABLE feedings DROP COLUMN duration;
ALTER TABLE feedings ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;

ALTER TABLE sleep DROP COLUMN duration;
ALTER TABLE sleep ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;

ALTER TABLE tummy_times DROP COLUMN duration;
ALTER TABLE tummy_times ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;

ALTER TABLE pumping DROP COLUMN duration;
ALTER TABLE pumping ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;
