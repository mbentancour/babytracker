-- Allow 's3' as a backup destination type alongside 'local' and 'webdav'.
-- The CHECK constraint is replaced because Postgres doesn't let you extend
-- an existing CHECK — you drop and recreate it.
ALTER TABLE backup_destinations DROP CONSTRAINT backup_destinations_type_check;
ALTER TABLE backup_destinations
    ADD CONSTRAINT backup_destinations_type_check
    CHECK (type IN ('local', 'webdav', 's3'));
