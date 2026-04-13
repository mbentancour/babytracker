import { useState } from "react";
import { api } from "../api";
import { FormField, FormInput, FormSelect } from "./Modal";
import { Icons } from "./Icons";
import UserManagement from "./UserManagement";
import {
  usePreferences,
  FEATURE_LIST,
  FEEDING_TYPES,
  FEEDING_METHODS,
} from "../utils/preferences";

const UNIT_OPTIONS = [
  { value: "metric", label: "Metric (kg, cm, mL, \u00b0C)" },
  { value: "imperial", label: "Imperial (lb, in, oz, \u00b0F)" },
];

const NAV_ITEMS = [
  { id: "general", label: "General", icon: <Icons.Settings /> },
  { id: "features", label: "Features", icon: <Icons.Activity /> },
  { id: "defaults", label: "Defaults", icon: <Icons.Clock /> },
  { id: "data", label: "Data", icon: <Icons.Download /> },
  { id: "users", label: "Users & Roles", icon: <Icons.Baby /> },
];

export default function SettingsModal({ childId, unitSystem, children, isAdmin, onClose, onLogout, onRefetch }) {
  const [section, setSection] = useState("general");
  const [units, setUnits] = useState(unitSystem || "metric");
  const [exporting, setExporting] = useState(false);
  const { prefs, setFeatureEnabled, setFormDefault, setPref } = usePreferences();
  const [deviceName, setDeviceName] = useState(
    () => localStorage.getItem("babytracker_device_name") || ""
  );

  const handleExport = async (type) => {
    setExporting(true);
    try {
      await api.exportCSV(childId, type);
    } catch {
      alert("Export failed");
    }
    setExporting(false);
  };

  return (
    <div className="settings-overlay">
      <div className="settings-page">
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose}>
            <Icons.X />
          </button>
        </div>

        <div className="settings-body">
          {/* Sidebar navigation */}
          <nav className="settings-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item ${section === item.id ? "settings-nav-active" : ""}`}
                onClick={() => setSection(item.id)}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="settings-content">
            {/* General */}
            {section === "general" && (
              <div className="settings-section">
                <h3 className="settings-section-title">General</h3>

                <div className="settings-card">
                  <FormField label="Unit System">
                    <FormSelect
                      options={UNIT_OPTIONS}
                      value={units}
                      onChange={(e) => {
                        setUnits(e.target.value);
                        localStorage.setItem("babytracker_units", e.target.value);
                        if (onRefetch) onRefetch();
                      }}
                    />
                  </FormField>
                </div>

                <div className="settings-card">
                  <FormField label="Picture Frame (screensaver)">
                    <FormSelect
                      options={[
                        { value: "0", label: "Disabled" },
                        { value: "1", label: "After 1 minute" },
                        { value: "2", label: "After 2 minutes" },
                        { value: "5", label: "After 5 minutes" },
                        { value: "10", label: "After 10 minutes" },
                        { value: "15", label: "After 15 minutes" },
                        { value: "30", label: "After 30 minutes" },
                      ]}
                      value={String(prefs.pictureFrameTimeout || 0)}
                      onChange={(e) => setPref("pictureFrameTimeout", parseInt(e.target.value))}
                    />
                  </FormField>
                  <p className="settings-hint">
                    After no interaction, the app shows a slideshow of your baby's photos. Tap anywhere to return.
                  </p>
                </div>

                <div className="settings-card">
                  <FormField label="Device Name">
                    <FormInput
                      type="text"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        localStorage.setItem("babytracker_device_name", name);
                        setDeviceName(name);
                      }}
                      placeholder="e.g. nursery-tablet"
                    />
                  </FormField>
                  <p className="settings-hint">
                    Optional. Identifies this device for remote control via Home Assistant.
                    Used to target specific devices when starting/stopping the picture frame.
                  </p>
                </div>

                {onLogout && (
                  <button onClick={onLogout} className="settings-signout">
                    <Icons.Logout />
                    Sign Out
                  </button>
                )}
              </div>
            )}

            {/* Features */}
            {section === "features" && (
              <div className="settings-section">
                <h3 className="settings-section-title">Features</h3>
                <p className="settings-hint" style={{ marginBottom: 16 }}>
                  Disable features you don't need. They'll be hidden from the menus and dashboard.
                </p>
                <div className="settings-card">
                  {FEATURE_LIST.map((f, i) => (
                    <label
                      key={f.id}
                      className="settings-toggle-row"
                      style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}
                    >
                      <div>
                        <div className="settings-toggle-label">{f.label}</div>
                        <div className="settings-toggle-desc">{f.description}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={prefs.features[f.id] !== false}
                        onChange={(e) => setFeatureEnabled(f.id, e.target.checked)}
                        className="settings-checkbox"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Defaults */}
            {section === "defaults" && (
              <div className="settings-section">
                <h3 className="settings-section-title">Form Defaults</h3>
                <p className="settings-hint" style={{ marginBottom: 16 }}>
                  Set default values for new entries. These will be pre-selected when you open a form.
                </p>

                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">Feeding Defaults</h4>
                  <div className="settings-card-grid">
                    <FormField label="Default Type">
                      <FormSelect
                        options={FEEDING_TYPES}
                        value={prefs.defaults.feeding?.type || "breast milk"}
                        onChange={(e) => setFormDefault("feeding", "type", e.target.value)}
                      />
                    </FormField>
                    <FormField label="Default Method">
                      <FormSelect
                        options={FEEDING_METHODS}
                        value={prefs.defaults.feeding?.method || "bottle"}
                        onChange={(e) => setFormDefault("feeding", "method", e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>

                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">Medication Defaults</h4>
                  <FormField label="Default Dosage Unit">
                    <FormSelect
                      options={[
                        { value: "ml", label: "ml" },
                        { value: "mg", label: "mg" },
                        { value: "drops", label: "drops" },
                        { value: "tsp", label: "tsp" },
                        { value: "units", label: "units" },
                      ]}
                      value={prefs.defaults.medication?.dosage_unit || "ml"}
                      onChange={(e) => setFormDefault("medication", "dosage_unit", e.target.value)}
                    />
                  </FormField>
                </div>

                <div className="settings-card">
                  <label className="settings-toggle-row">
                    <div>
                      <div className="settings-toggle-label">Auto-calculate BMI</div>
                      <div className="settings-toggle-desc">
                        Fill BMI from weight and height when no doctor-provided value exists. Manual entries always take priority.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={prefs.autoCalculateBMI !== false}
                      onChange={(e) => setPref("autoCalculateBMI", e.target.checked)}
                      className="settings-checkbox"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Data */}
            {section === "data" && (
              <div className="settings-section">
                <h3 className="settings-section-title">Data</h3>

                {/* Export */}
                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">Export (CSV)</h4>
                  <button
                    className="settings-export-main"
                    onClick={() => handleExport("all")}
                    disabled={exporting || !childId}
                    style={{ marginBottom: 12 }}
                  >
                    <Icons.Download />
                    {exporting ? "Exporting..." : "Export All Data (CSV)"}
                  </button>
                  <div className="settings-export-grid">
                    {["feedings", "sleep", "changes", "weight", "height", "head_circumference", "temperature", "medications", "milestones"].map((type) => (
                      <button
                        key={type}
                        className="settings-export-item"
                        onClick={() => handleExport(type)}
                        disabled={exporting || !childId}
                      >
                        {type.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Backups (admin only) */}
                {isAdmin && <BackupSection />}
              </div>
            )}

            {/* Users */}
            {section === "users" && (
              <div className="settings-section">
                <h3 className="settings-section-title">Users & Roles</h3>
                {isAdmin ? (
                  <UserManagement children={children || []} />
                ) : (
                  <div className="settings-card" style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
                    Only admins can manage users and roles.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BackupSection() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const refresh = () => {
    api.getBackups()
      .then((res) => setBackups(res.results || []))
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  };

  useState(() => { refresh(); });

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      refresh();
    } catch {
      alert("Backup failed");
    }
    setCreating(false);
  };

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Restoring a backup will overwrite current data. Are you sure?")) {
      e.target.value = "";
      return;
    }
    setRestoring(true);
    try {
      await api.restoreBackup(file);
      alert("Backup restored. The page will reload.");
      window.location.reload();
    } catch {
      alert("Restore failed");
    }
    setRestoring(false);
    e.target.value = "";
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="settings-card">
      <h4 className="settings-card-title">Backups</h4>
      <p className="settings-hint" style={{ marginBottom: 12 }}>
        Automatic daily backups are kept for 7 days. You can also create manual backups or restore from a file.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className="settings-export-main"
          onClick={handleCreate}
          disabled={creating}
          style={{ flex: 1 }}
        >
          {creating ? "Creating..." : "Create Backup Now"}
        </button>
        <label
          className="settings-export-main"
          style={{ flex: 1, cursor: restoring ? "not-allowed" : "pointer", opacity: restoring ? 0.6 : 1, textAlign: "center" }}
        >
          {restoring ? "Restoring..." : "Restore from File"}
          <input
            type="file"
            accept=".gz,.sql.gz"
            style={{ display: "none" }}
            onChange={handleRestore}
            disabled={restoring}
          />
        </label>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>Loading...</div>
      ) : backups.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>No backups yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {backups.map((b) => (
            <div
              key={b.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, color: "var(--text)" }}>{b.date}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{formatSize(b.size)}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="settings-export-item"
                  style={{ padding: "4px 10px" }}
                  onClick={() => api.downloadBackup(b.name).catch(() => alert("Download failed"))}
                >
                  Download
                </button>
                <button
                  className="delete-entry-btn"
                  onClick={async () => {
                    if (confirm("Delete this backup?")) {
                      await api.deleteBackup(b.name);
                      refresh();
                    }
                  }}
                >
                  x
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
