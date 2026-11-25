-- Which UI a user gets when they sign in (an id from the frontend's UI
-- registry, frontend/src/uis/index.js). Empty means "the default UI". A device
-- can still override it locally; that choice never reaches the server.
ALTER TABLE users ADD COLUMN ui TEXT NOT NULL DEFAULT '';
