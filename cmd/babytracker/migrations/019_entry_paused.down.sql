-- Restore the 014 duration definition and drop the paused time.

ALTER TABLE feedings DROP COLUMN duration;
ALTER TABLE feedings DROP COLUMN paused_seconds;
ALTER TABLE feedings ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;

ALTER TABLE sleep DROP COLUMN duration;
ALTER TABLE sleep DROP COLUMN paused_seconds;
ALTER TABLE sleep ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;

ALTER TABLE tummy_times DROP COLUMN duration;
ALTER TABLE tummy_times DROP COLUMN paused_seconds;
ALTER TABLE tummy_times ADD COLUMN duration INTERVAL
    GENERATED ALWAYS AS (GREATEST(end_time - start_time, INTERVAL '0')) STORED;
