-- Migrate existing photos.child_id to photo_children, then drop the column.
-- This makes photo_children the single source of truth for photo-child associations.
INSERT INTO photo_children (photo_filename, child_id)
SELECT filename, child_id FROM photos
WHERE child_id IS NOT NULL
ON CONFLICT (photo_filename, child_id) DO NOTHING;

ALTER TABLE photos DROP COLUMN IF EXISTS child_id;
