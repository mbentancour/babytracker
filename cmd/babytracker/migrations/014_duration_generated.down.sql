-- Revert duration back to a plain INTERVAL. We backfill from the generated
-- value before dropping it so rows keep correct durations on rollback;
-- future writes won't auto-recompute, so the original stale-on-edit bug
-- returns until/unless the up migration is reapplied.

ALTER TABLE feedings ADD COLUMN duration_old INTERVAL;
UPDATE feedings SET duration_old = duration;
ALTER TABLE feedings DROP COLUMN duration;
ALTER TABLE feedings RENAME COLUMN duration_old TO duration;

ALTER TABLE sleep ADD COLUMN duration_old INTERVAL;
UPDATE sleep SET duration_old = duration;
ALTER TABLE sleep DROP COLUMN duration;
ALTER TABLE sleep RENAME COLUMN duration_old TO duration;

ALTER TABLE tummy_times ADD COLUMN duration_old INTERVAL;
UPDATE tummy_times SET duration_old = duration;
ALTER TABLE tummy_times DROP COLUMN duration;
ALTER TABLE tummy_times RENAME COLUMN duration_old TO duration;

ALTER TABLE pumping ADD COLUMN duration_old INTERVAL;
UPDATE pumping SET duration_old = duration;
ALTER TABLE pumping DROP COLUMN duration;
ALTER TABLE pumping RENAME COLUMN duration_old TO duration;
