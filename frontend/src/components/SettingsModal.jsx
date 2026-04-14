import { useState } from "react";
import { api } from "../api";
import { FormField, FormInput, FormSelect } from "./Modal";
import { Icons } from "./Icons";
import UserManagement from "./UserManagement";
import { useI18n, AVAILABLE_LANGUAGES } from "../utils/i18n";
import {
  usePreferences,
  FEATURE_LIST,
  FEEDING_TYPES,
  FEEDING_METHODS,
} from "../utils/preferences";

const UNIT_OPTIONS = [
  { value: "metric", label: "settings.metric" },
  { value: "imperial", label: "settings.imperial" },
];

const NAV_ITEMS = [
  { id: "general", label: "settings.general", icon: <Icons.Settings /> },
  { id: "features", label: "settings.features", icon: <Icons.Activity /> },
  { id: "defaults", label: "settings.defaults", icon: <Icons.Clock /> },
  { id: "data", label: "settings.data", icon: <Icons.Download /> },
  { id: "users", label: "settings.users", icon: <Icons.Baby /> },
];

export default function SettingsModal({ childId, unitSystem, children, isAdmin, onClose, onLogout, onRefetch }) {
  const { t, locale, setLocale } = useI18n();
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
          <h2 className="settings-title">{t("settings.title")}</h2>
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
                <span>{t(item.label)}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="settings-content">
            {/* General */}
            {section === "general" && (
              <div className="settings-section">
                <h3 className="settings-section-title">{t("settings.general")}</h3>

                <div className="settings-card">
                  <FormField label={t("settings.unitSystem")}>
                    <FormSelect
                      options={UNIT_OPTIONS.map(o => ({ ...o, label: t(o.label) }))}
                      value={units}
                      onChange={(e) => {
                        setUnits(e.target.value);
                        localStorage.setItem("babytracker_units", e.target.value);
                        if (onRefetch) onRefetch();
                      }}
                    />
                  </FormField>
                  <FormField label={t("settings.theme")}>
                    <FormSelect
                      options={[
                        { value: "system", label: t("settings.themeSystem") },
                        { value: "dark", label: t("settings.themeDark") },
                        { value: "light", label: t("settings.themeLight") },
                      ]}
                      value={prefs.theme || "system"}
                      onChange={(e) => setPref("theme", e.target.value)}
                    />
                  </FormField>
                  <FormField label={t("settings.language")}>
                    <FormSelect
                      options={AVAILABLE_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                    />
                  </FormField>
                </div>

                <div className="settings-card">
                  <FormField label={t("settings.pictureFrame")}>
                    <FormSelect
                      options={[
                        { value: "0", label: t("settings.disabled") },
                        { value: "1", label: t("settings.after1min") },
                        { value: "2", label: t("settings.after2min") },
                        { value: "5", label: t("settings.after5min") },
                        { value: "10", label: t("settings.after10min") },
                        { value: "15", label: t("settings.after15min") },
                        { value: "30", label: t("settings.after30min") },
                      ]}
                      value={String(prefs.pictureFrameTimeout || 0)}
                      onChange={(e) => setPref("pictureFrameTimeout", parseInt(e.target.value))}
                    />
                  </FormField>
                  <p className="settings-hint">
                    {t("settings.pictureFrameHint")}
                  </p>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                      {t("settings.slideshowContent")}
                    </div>

                    {children && children.length > 1 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("settings.showPhotosFrom")}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {children.map((c) => {
                            const selected = prefs.pictureFrame.childIds.length === 0 || prefs.pictureFrame.childIds.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                onClick={() => {
                                  const current = prefs.pictureFrame.childIds;
                                  let next;
                                  if (current.length === 0) {
                                    // Currently "all" — switch to all except this one
                                    next = children.map((ch) => ch.id).filter((id) => id !== c.id);
                                  } else if (current.includes(c.id)) {
                                    next = current.filter((id) => id !== c.id);
                                  } else {
                                    next = [...current, c.id];
                                  }
                                  // If all selected, reset to empty (means "all")
                                  if (next.length === children.length) next = [];
                                  setPref("pictureFrame", { ...prefs.pictureFrame, childIds: next });
                                }}
                                style={{
                                  fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
                                  border: `1px solid ${selected ? "#6C5CE7" : "var(--border)"}`,
                                  background: selected ? "#6C5CE718" : "none",
                                  color: selected ? "#6C5CE7" : "var(--text-dim)",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                {c.first_name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      {[
                        { key: "showShared", labelKey: "settings.sharedPhotos" },
                        { key: "showPhoto", labelKey: "settings.standalonePhotos" },
                        { key: "showProfile", labelKey: "settings.profilePictures" },
                        { key: "showMilestone", labelKey: "journal.milestones" },
                        { key: "showWeight", labelKey: "growth.weight" },
                        { key: "showHeight", labelKey: "growth.height" },
                        { key: "showHeadCirc", labelKey: "growth.headCirc" },
                        { key: "showTemp", labelKey: "overview.temperature" },
                        { key: "showMedication", labelKey: "journal.medications" },
                        { key: "showNote", labelKey: "journal.notes" },
                      ].map(({ key, labelKey }) => (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                          <input
                            type="checkbox"
                            checked={prefs.pictureFrame[key] !== false}
                            onChange={(e) => setPref("pictureFrame", { ...prefs.pictureFrame, [key]: e.target.checked })}
                            style={{ width: 14, height: 14, accentColor: "#6C5CE7" }}
                          />
                          {t(labelKey)}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <FormField label={t("settings.deviceName")}>
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
                    {t("settings.deviceNameHint")}
                  </p>
                </div>

                {onLogout && <ChangePasswordSection />}

                {onLogout && (
                  <button onClick={onLogout} className="settings-signout">
                    <Icons.Logout />
                    {t("settings.signOut")}
                  </button>
                )}
              </div>
            )}

            {/* Features */}
            {section === "features" && (
              <div className="settings-section">
                <h3 className="settings-section-title">{t("settings.features")}</h3>
                <p className="settings-hint" style={{ marginBottom: 16 }}>
                  {t("settings.featuresHint")}
                </p>
                <div className="settings-card">
                  {FEATURE_LIST.map((f, i) => (
                    <label
                      key={f.id}
                      className="settings-toggle-row"
                      style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}
                    >
                      <div>
                        <div className="settings-toggle-label">{t(f.labelKey)}</div>
                        <div className="settings-toggle-desc">{t(f.descKey)}</div>
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
                <h3 className="settings-section-title">{t("settings.defaults")}</h3>
                <p className="settings-hint" style={{ marginBottom: 16 }}>
                  {t("settings.defaultsHint")}
                </p>

                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">{t("settings.feedingDefaults")}</h4>
                  <div className="settings-card-grid">
                    <FormField label={t("settings.defaultType")}>
                      <FormSelect
                        options={FEEDING_TYPES.map(o => ({ ...o, label: t(o.labelKey) }))}
                        value={prefs.defaults.feeding?.type || "breast milk"}
                        onChange={(e) => setFormDefault("feeding", "type", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("settings.defaultMethod")}>
                      <FormSelect
                        options={FEEDING_METHODS.map(o => ({ ...o, label: t(o.labelKey) }))}
                        value={prefs.defaults.feeding?.method || "bottle"}
                        onChange={(e) => setFormDefault("feeding", "method", e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>

                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">{t("settings.medicationDefaults")}</h4>
                  <FormField label={t("settings.defaultDosageUnit")}>
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
                      <div className="settings-toggle-label">{t("settings.autoCalculateBMI")}</div>
                      <div className="settings-toggle-desc">
                        {t("settings.autoCalculateBMIHint")}
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
                <h3 className="settings-section-title">{t("settings.data")}</h3>

                {/* Export */}
                <div className="settings-card" style={{ marginBottom: 16 }}>
                  <h4 className="settings-card-title">{t("settings.export")}</h4>
                  <button
                    className="settings-export-main"
                    onClick={() => handleExport("all")}
                    disabled={exporting || !childId}
                    style={{ marginBottom: 12 }}
                  >
                    <Icons.Download />
                    {exporting ? "Exporting..." : t("settings.exportAll")}
                  </button>
                  <div className="settings-export-grid">
                    {["feedings", "sleep", "changes", "weight", "height", "head_circumference", "temperature", "medications", "milestones"].map((type) => (
                      <button
                        key={type}
                        className="settings-export-item"
                        onClick={() => handleExport(type)}
                        disabled={exporting || !childId}
                      >
                        {t(`export.${type}`)}
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
                <h3 className="settings-section-title">{t("settings.users")}</h3>
                {isAdmin ? (
                  <UserManagement children={children || []} />
                ) : (
                  <div className="settings-card" style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
                    {t("settings.adminOnly")}
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
  const { t } = useI18n();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [frequency, setFrequency] = useState("daily");

  const refresh = () => {
    Promise.all([api.getBackups(), api.getBackupSettings()])
      .then(([backupsRes, settingsRes]) => {
        setBackups(backupsRes.results || []);
        setFrequency(settingsRes.frequency || "daily");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useState(() => { refresh(); });

  const handleFrequencyChange = async (newFreq) => {
    setFrequency(newFreq);
    try {
      await api.updateBackupSettings(newFreq);
    } catch {
      alert("Failed to update backup frequency");
    }
  };

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
      <h4 className="settings-card-title">{t("settings.backups")}</h4>

      <div style={{ marginBottom: 16 }}>
        <FormField label={t("settings.backupFrequency")}>
          <FormSelect
            options={[
              { value: "disabled", label: t("settings.disabled") },
              { value: "6h", label: t("settings.every6h") },
              { value: "12h", label: t("settings.every12h") },
              { value: "daily", label: t("settings.daily") },
              { value: "weekly", label: t("settings.weekly") },
            ]}
            value={frequency}
            onChange={(e) => handleFrequencyChange(e.target.value)}
          />
        </FormField>
        <p className="settings-hint">
          {frequency === "disabled"
            ? t("settings.backupDisabledHint")
            : t("settings.backupEnabledHint")}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className="settings-export-main"
          onClick={handleCreate}
          disabled={creating}
          style={{ flex: 1 }}
        >
          {creating ? t("settings.creating") : t("settings.createBackup")}
        </button>
        <label
          className="settings-export-main"
          style={{ flex: 1, cursor: restoring ? "not-allowed" : "pointer", opacity: restoring ? 0.6 : 1, textAlign: "center" }}
        >
          {restoring ? t("settings.restoring") : t("settings.restoreFromFile")}
          <input
            type="file"
            accept=".gz,.tar.gz"
            style={{ display: "none" }}
            onChange={handleRestore}
            disabled={restoring}
          />
        </label>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("general.loading")}</div>
      ) : backups.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("settings.noBackups")}</div>
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
                  {t("settings.download")}
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

function ChangePasswordSection() {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords don't match" });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters" });
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage({ type: "success", text: t("settings.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setMessage({ type: "error", text: err.error || err.message || "Failed to change password" });
    }
    setSaving(false);
  };

  return (
    <div className="settings-card" style={{ marginTop: 16 }}>
      <h4 className="settings-card-title">{t("settings.changePassword")}</h4>
      <form onSubmit={handleSubmit}>
        {message && (
          <div style={{
            padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13,
            background: message.type === "error" ? "#e74c3c18" : "#00b89418",
            color: message.type === "error" ? "#e74c3c" : "#00b894",
          }}>
            {message.text}
          </div>
        )}
        <FormField label={t("settings.currentPassword")}>
          <FormInput type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        </FormField>
        <FormField label={t("settings.newPassword")}>
          <FormInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </FormField>
        <FormField label={t("settings.confirmNewPassword")}>
          <FormInput type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </FormField>
        <button type="submit" className="settings-export-main" disabled={saving} style={{ marginTop: 4 }}>
          {saving ? t("settings.changing") : t("settings.changePasswordBtn")}
        </button>
      </form>
    </div>
  );
}
