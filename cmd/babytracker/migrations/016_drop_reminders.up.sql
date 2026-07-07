-- Remove the reminders feature. The table (added in 002) was only ever wired
-- to a CRUD API with no scheduler firing it and no UI managing it — dead
-- weight. Dropped here rather than editing the historical 002 migration so
-- existing deployments converge cleanly.
DROP TABLE IF EXISTS reminders;
