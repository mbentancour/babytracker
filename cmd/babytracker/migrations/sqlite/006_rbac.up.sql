-- Roles table
CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

-- Feature permissions per role
-- access_level: 'none', 'read', 'write'
CREATE TABLE role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    access_level TEXT NOT NULL DEFAULT 'none'
        CHECK (access_level IN ('none', 'read', 'write')),
    UNIQUE(role_id, feature)
);

-- Which children a user can access, and with which role
CREATE TABLE user_children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, child_id)
);

-- Add is_admin flag to users table
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Make the first user an admin
UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users);

-- Insert predefined system roles
INSERT INTO roles (name, description, is_system) VALUES
    ('parent', 'Full access to assigned children', 1),
    ('caregiver', 'Configurable access to assigned children', 1),
    ('viewer', 'Read-only access to assigned children', 1);

-- Parent role: write access to everything
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'feeding', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'sleep', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'diaper', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'tummy', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'temp', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'weight', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'height', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'headcirc', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'pumping', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'bmi', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'medication', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'milestone', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'note', 'write' FROM roles WHERE name = 'parent';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'photo', 'write' FROM roles WHERE name = 'parent';

-- Caregiver role: write on daily tracking, read on measurements
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'feeding', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'sleep', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'diaper', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'tummy', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'temp', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'medication', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'note', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'photo', 'read' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'weight', 'read' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'height', 'read' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'headcirc', 'read' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'pumping', 'write' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'bmi', 'read' FROM roles WHERE name = 'caregiver';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'milestone', 'read' FROM roles WHERE name = 'caregiver';

-- Viewer role: read-only everything
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'feeding', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'sleep', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'diaper', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'tummy', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'temp', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'weight', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'height', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'headcirc', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'pumping', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'bmi', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'medication', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'milestone', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'note', 'read' FROM roles WHERE name = 'viewer';
INSERT INTO role_permissions (role_id, feature, access_level)
  SELECT id, 'photo', 'read' FROM roles WHERE name = 'viewer';

CREATE INDEX idx_user_children_user ON user_children(user_id);
CREATE INDEX idx_user_children_child ON user_children(child_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
