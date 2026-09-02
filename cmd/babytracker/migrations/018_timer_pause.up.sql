-- Add pause support to timers
ALTER TABLE timers ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE timers ADD COLUMN IF NOT EXISTS pauses JSONB DEFAULT '[]'::jsonb;
