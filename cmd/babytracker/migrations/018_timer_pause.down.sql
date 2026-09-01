-- Rollback pause support
ALTER TABLE timers DROP COLUMN pauses;
ALTER TABLE timers DROP COLUMN paused_elapsed;
ALTER TABLE timers DROP COLUMN is_paused;
