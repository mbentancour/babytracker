ALTER TABLE backup_destinations DROP CONSTRAINT backup_destinations_type_check;
ALTER TABLE backup_destinations
    ADD CONSTRAINT backup_destinations_type_check
    CHECK (type IN ('local', 'webdav'));
