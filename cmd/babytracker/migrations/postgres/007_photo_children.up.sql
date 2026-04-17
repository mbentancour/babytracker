-- Link photos to children (many-to-many)
-- A photo can be tagged with multiple children
CREATE TABLE photo_children (
    id SERIAL PRIMARY KEY,
    photo_filename TEXT NOT NULL,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(photo_filename, child_id)
);
CREATE INDEX idx_photo_children_filename ON photo_children(photo_filename);
CREATE INDEX idx_photo_children_child ON photo_children(child_id);
