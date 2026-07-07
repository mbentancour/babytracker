-- Indexes for reverse photo->child ownership lookups.
--
-- ServePhoto (media.go) authorizes every image request by asking which
-- children a filename belongs to: a UNION of `WHERE photo = $1` across all
-- entry tables plus children.picture. Without these, each request sequentially
-- scans the busiest tables in the app (feedings/sleep/changes/...), and a
-- gallery page fires ~100 such requests. Partial indexes (photo != '') keep
-- them tiny — only rows that actually have a photo are indexed, which is a
-- small minority — while making each lookup an index probe.
--
-- photo_children.photo_filename and children have their own indexes already
-- (idx_photo_children_filename); children.picture is low-cardinality and small
-- enough that a scan is negligible, so it's left unindexed.
CREATE INDEX IF NOT EXISTS idx_feedings_photo ON feedings(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_sleep_photo ON sleep(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_changes_photo ON changes(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_tummy_times_photo ON tummy_times(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_temperature_photo ON temperature(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_weight_photo ON weight(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_height_photo ON height(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_head_circumference_photo ON head_circumference(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_pumping_photo ON pumping(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_medications_photo ON medications(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_milestones_photo ON milestones(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_notes_photo ON notes(photo) WHERE photo != '';
CREATE INDEX IF NOT EXISTS idx_bmi_photo ON bmi(photo) WHERE photo != '';
