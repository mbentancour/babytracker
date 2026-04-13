-- Roles table
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feature permissions per role
-- access_level: 'none', 'read', 'write'
CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    access_level TEXT NOT NULL DEFAULT 'none'
        CHECK (access_level IN ('none', 'read', 'write')),
    UNIQUE(role_id, feature)
);

-- Which children a user can access, and with which role
CREATE TABLE user_children (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, child_id)
);

-- Add is_admin flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Make the first user an admin
UPDATE users SET is_admin = TRUE WHERE id = (SELECT MIN(id) FROM users);

-- Insert predefined system roles
INSERT INTO roles (name, description, is_system) VALUES
    ('parent', 'Full access to assigned children', TRUE),
    ('caregiver', 'Configurable access to assigned children', TRUE),
    ('viewer', 'Read-only access to assigned children', TRUE);

-- Parent role: write access to everything
INSERT INTO role_permissions (role_id, feature, access_level)
SELECT r.id, f.feature, 'write'
FROM roles r,
     (VALUES ('feeding'), ('sleep'), ('diaper'), ('tummy'), ('temp'),
             ('weight'), ('height'), ('headcirc'), ('pumping'), ('bmi'),
             ('medication'), ('milestone'), ('note'), ('photo')) AS f(feature)
WHERE r.name = 'parent';

-- Caregiver role: write on daily tracking, read on measurements
INSERT INTO role_permissions (role_id, feature, access_level)
SELECT r.id, f.feature, f.level
FROM roles r,
     (VALUES ('feeding', 'write'), ('sleep', 'write'), ('diaper', 'write'),
             ('tummy', 'write'), ('temp', 'write'), ('medication', 'write'),
             ('note', 'write'), ('photo', 'read'),
             ('weight', 'read'), ('height', 'read'), ('headcirc', 'read'),
             ('pumping', 'write'), ('bmi', 'read'), ('milestone', 'read')) AS f(feature, level)
WHERE r.name = 'caregiver';

-- Viewer role: read-only everything
INSERT INTO role_permissions (role_id, feature, access_level)
SELECT r.id, f.feature, 'read'
FROM roles r,
     (VALUES ('feeding'), ('sleep'), ('diaper'), ('tummy'), ('temp'),
             ('weight'), ('height'), ('headcirc'), ('pumping'), ('bmi'),
             ('medication'), ('milestone'), ('note'), ('photo')) AS f(feature)
WHERE r.name = 'viewer';

CREATE INDEX idx_user_children_user ON user_children(user_id);
CREATE INDEX idx_user_children_child ON user_children(child_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
