-- The global backup_frequency setting was replaced by per-destination cron
-- schedules (backup_destinations.schedule) in migration 011. Drop the now-
-- orphan row so `SELECT ... FROM settings` returns a clean slate.
DELETE FROM settings WHERE key = 'backup_frequency';
