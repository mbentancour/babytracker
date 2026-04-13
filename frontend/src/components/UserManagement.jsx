import { useState, useEffect } from "react";
import { api } from "../api";
import { FormField, FormInput, FormSelect, FormButton } from "./Modal";

const FEATURES = [
  "feeding", "sleep", "diaper", "tummy", "temp",
  "weight", "height", "headcirc", "pumping", "bmi",
  "medication", "milestone", "note", "photo",
];

export default function UserManagement({ children }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);

  const refresh = () => {
    Promise.all([api.getUsers(), api.getRoles()])
      .then(([u, r]) => {
        setUsers(u.results || []);
        setRoles(r.results || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  if (loading) return <div style={{ color: "var(--text-dim)", padding: 20, textAlign: "center" }}>Loading...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Users */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Users</div>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            style={{ fontSize: 12, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            {showAddUser ? "Cancel" : "+ Add User"}
          </button>
        </div>

        {showAddUser && <AddUserForm onDone={() => { setShowAddUser(false); refresh(); }} />}

        {users.map((user) => (
          <UserCard key={user.id} user={user} roles={roles} children={children} onRefresh={refresh} />
        ))}
      </div>

      {/* Roles */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Roles</div>
          <button
            onClick={() => setShowAddRole(!showAddRole)}
            style={{ fontSize: 12, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            {showAddRole ? "Cancel" : "+ Custom Role"}
          </button>
        </div>

        {showAddRole && <AddRoleForm onDone={() => { setShowAddRole(false); refresh(); }} />}

        {roles.map((role) => (
          <RoleCard key={role.id} role={role} onRefresh={refresh} />
        ))}
      </div>
    </div>
  );
}

function AddUserForm({ onDone }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createUser({ username, password, is_admin: isAdmin });
      onDone();
    } catch (err) {
      setError(err.error || err.message || "Failed");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)", marginBottom: 12 }}>
      {error && <div style={{ color: "#e74c3c", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <FormField label="Username">
        <FormInput type="text" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
      </FormField>
      <FormField label="Password">
        <FormInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </FormField>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} style={{ accentColor: "#6C5CE7" }} />
        Admin (full access to everything)
      </label>
      <FormButton color="#6C5CE7" disabled={saving}>
        {saving ? "Creating..." : "Create User"}
      </FormButton>
    </form>
  );
}

function UserCard({ user, roles, children, onRefresh }) {
  const [showGrant, setShowGrant] = useState(false);
  const [grantChild, setGrantChild] = useState("");
  const [grantRole, setGrantRole] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [newPw, setNewPw] = useState("");

  const handleGrant = async () => {
    if (!grantChild || !grantRole) return;
    await api.grantAccess(user.id, parseInt(grantChild), parseInt(grantRole));
    setShowGrant(false);
    setGrantChild("");
    setGrantRole("");
    onRefresh();
  };

  return (
    <div style={{ background: "var(--bg)", borderRadius: 10, padding: 12, border: "1px solid var(--border)", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{user.username}</span>
          {user.is_admin && (
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6C5CE7", background: "#6C5CE718", padding: "2px 6px", borderRadius: 4, marginLeft: 8 }}>
              ADMIN
            </span>
          )}
        </div>
        {!user.is_admin && (
          <button
            className="delete-entry-btn"
            onClick={async () => {
              if (confirm(`Delete user "${user.username}"?`)) {
                await api.deleteUser(user.id);
                onRefresh();
              }
            }}
          >
            x
          </button>
        )}
      </div>

      {!user.is_admin && (
        <>
          {/* Current access */}
          {user.access?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {user.access.map((a) => (
                <div key={a.child_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted)", padding: "4px 8px", borderRadius: 6, background: "var(--card-bg)" }}>
                  <span>{a.child_name} — <strong style={{ color: "var(--text)" }}>{a.role_name}</strong></span>
                  <button
                    className="delete-entry-btn"
                    style={{ fontSize: 11 }}
                    onClick={async () => { await api.revokeAccess(user.id, a.child_id); onRefresh(); }}
                  >
                    revoke
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>No child access assigned</div>
          )}

          {/* Grant access */}
          {showGrant ? (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <FormSelect
                  options={[{ value: "", label: "Child..." }, ...children.map((c) => ({ value: String(c.id), label: c.first_name }))]}
                  value={grantChild}
                  onChange={(e) => setGrantChild(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <FormSelect
                  options={[{ value: "", label: "Role..." }, ...roles.map((r) => ({ value: String(r.id), label: r.name }))]}
                  value={grantRole}
                  onChange={(e) => setGrantRole(e.target.value)}
                />
              </div>
              <button onClick={handleGrant} disabled={!grantChild || !grantRole}
                style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#6C5CE7", color: "white", fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                Grant
              </button>
            </div>
          ) : (
            <button onClick={() => setShowGrant(true)}
              style={{ fontSize: 11, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              + Grant child access
            </button>
          )}

          {/* Reset password */}
          {showResetPw ? (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="New password (min 8 chars)"
                style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
              />
              <button
                onClick={async () => {
                  if (newPw.length < 8) { alert("Password must be at least 8 characters"); return; }
                  await api.resetUserPassword(user.id, newPw);
                  setShowResetPw(false);
                  setNewPw("");
                  alert("Password reset");
                }}
                style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#6C5CE7", color: "white", fontSize: 11, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
              >
                Reset
              </button>
              <button onClick={() => { setShowResetPw(false); setNewPw(""); }}
                style={{ fontSize: 11, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowResetPw(true)}
              style={{ fontSize: 11, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", marginTop: 6 }}>
              Reset password
            </button>
          )}
        </>
      )}
    </div>
  );
}

function AddRoleForm({ onDone }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [perms, setPerms] = useState({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createRole({ name, description: desc, permissions: perms });
      onDone();
    } catch { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)", marginBottom: 12 }}>
      <FormField label="Role Name">
        <FormInput type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Babysitter" />
      </FormField>
      <FormField label="Description">
        <FormInput type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
      </FormField>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>Permissions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        {FEATURES.map((f) => (
          <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>{f}</span>
            <select
              value={perms[f] || "none"}
              onChange={(e) => setPerms((p) => ({ ...p, [f]: e.target.value }))}
              style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontFamily: "inherit" }}
            >
              <option value="none">None</option>
              <option value="read">Read</option>
              <option value="write">Write</option>
            </select>
          </div>
        ))}
      </div>
      <FormButton color="#6C5CE7" disabled={saving}>
        {saving ? "Creating..." : "Create Role"}
      </FormButton>
    </form>
  );
}

function RoleCard({ role, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [perms, setPerms] = useState({});

  useEffect(() => {
    const p = {};
    for (const perm of role.permissions || []) {
      p[perm.feature] = perm.access_level;
    }
    setPerms(p);
  }, [role]);

  const handleSave = async () => {
    await api.updateRolePermissions(role.id, perms);
    setEditing(false);
    onRefresh();
  };

  return (
    <div style={{ background: "var(--bg)", borderRadius: 10, padding: 12, border: "1px solid var(--border)", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{role.name}</span>
          {role.is_system && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 6 }}>system</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(!editing)}
            style={{ fontSize: 11, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            {editing ? "Cancel" : "Edit"}
          </button>
          {!role.is_system && (
            <button className="delete-entry-btn" style={{ fontSize: 11 }}
              onClick={async () => { if (confirm(`Delete role "${role.name}"?`)) { await api.deleteRole(role.id); onRefresh(); } }}>
              x
            </button>
          )}
        </div>
      </div>
      {role.description && <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>{role.description}</div>}

      {editing ? (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {FEATURES.map((f) => (
              <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>{f}</span>
                <select
                  value={perms[f] || "none"}
                  onChange={(e) => setPerms((p) => ({ ...p, [f]: e.target.value }))}
                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontFamily: "inherit" }}
                >
                  <option value="none">None</option>
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                </select>
              </div>
            ))}
          </div>
          <button onClick={handleSave}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#6C5CE7", color: "white", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Save Permissions
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(role.permissions || []).filter((p) => p.access_level !== "none").map((p) => (
            <span key={p.feature} style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              background: p.access_level === "write" ? "#00b89418" : "#3498db18",
              color: p.access_level === "write" ? "#00b894" : "#3498db",
            }}>
              {p.feature}: {p.access_level}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
