-- Per-destination backup schedule (cron expression). Empty string means the
-- destination is never backed up automatically (equivalent to auto_backup=false);
-- any valid 5-field cron expression runs on that schedule. Default covers the
-- seeded "Local" destination so existing installs keep getting backups.
ALTER TABLE backup_destinations
    ADD COLUMN schedule TEXT NOT NULL DEFAULT '0 3 * * *';

-- Existing destinations with auto_backup=false should not start running just
-- because we added a default; clear their schedule to preserve behaviour.
UPDATE backup_destinations SET schedule = '' WHERE auto_backup = FALSE;
