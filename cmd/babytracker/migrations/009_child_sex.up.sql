-- Add sex column to children table (nullable — users may not want to specify).
-- Used for WHO growth percentile charts which differ between boys and girls.
ALTER TABLE children ADD COLUMN sex TEXT CHECK (sex IN ('male', 'female') OR sex IS NULL);
