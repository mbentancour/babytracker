import { useState, useEffect } from "react";
import { api } from "../api";
import { FormField, FormInput, FormSelect, FormButton } from "./Modal";
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
  { id: "integrations", label: "settings.integrations", icon: <Icons.Link /> },
  { id: "users", label: "settings.users", icon: <Icons.Baby /> },
];

// formatBackupDate renders the backup list's `date` field. The backend emits
// RFC3339 UTC (e.g. "2026-04-16T10:35:22Z"); show it in the browser's locale.
// Falls through on parse failure so older backend responses — which emitted
// naive "YYYY-MM-DD HH:MM:SS" — still display as-is rather than "Invalid Date".
function formatBackupDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

export default function SettingsModal({ childId, unitSystem, children, isAdmin, applianceMode, onClose, onLogout, onRefetch }) {
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

                  <FormField label={t("settings.slideDuration")}>
                    <FormSelect
                      options={[
                        { value: "5", label: t("settings.seconds", { n: 5 }) },
                        { value: "8", label: t("settings.seconds", { n: 8 }) },
                        { value: "10", label: t("settings.seconds", { n: 10 }) },
                        { value: "15", label: t("settings.seconds", { n: 15 }) },
                        { value: "20", label: t("settings.seconds", { n: 20 }) },
                        { value: "30", label: t("settings.seconds", { n: 30 }) },
                        { value: "60", label: t("settings.seconds", { n: 60 }) },
                      ]}
                      value={String(prefs.pictureFrame?.slideDuration || 8)}
                      onChange={(e) => setPref("pictureFrame", { ...prefs.pictureFrame, slideDuration: parseInt(e.target.value) })}
                    />
                  </FormField>

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

                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        {t("settings.pictureFrameOverlay")}
                      </div>
                      <p className="settings-hint" style={{ marginBottom: 8 }}>
                        {t("settings.pictureFrameOverlayHint")}
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                        {[
                          { key: "lastFeeding", labelKey: "settings.overlayLastFeeding" },
                          { key: "lastSleep", labelKey: "settings.overlayLastSleep" },
                          { key: "lastDiaper", labelKey: "settings.overlayLastDiaper" },
                          { key: "timers", labelKey: "settings.overlayTimers" },
                          { key: "currentTime", labelKey: "settings.overlayCurrentTime" },
                        ].map(({ key, labelKey }) => (
                          <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                            <input
                              type="checkbox"
                              checked={!!prefs.pictureFrame.overlay?.[key]}
                              onChange={(e) => setPref("pictureFrame", {
                                ...prefs.pictureFrame,
                                overlay: { ...prefs.pictureFrame.overlay, [key]: e.target.checked },
                              })}
                              style={{ width: 14, height: 14, accentColor: "#6C5CE7" }}
                            />
                            {t(labelKey)}
                          </label>
                        ))}
                      </div>
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

                {onLogout && applianceMode && <DomainSection />}

                {onLogout && <TLSSection />}

                {onLogout && <ChangePasswordSection />}

                {onLogout && (
                  <button onClick={onLogout} className="settings-signout">
                    <Icons.Logout />
                    {t("settings.signOut")}
                  </button>
                )}

                {onLogout && applianceMode && (
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button
                      className="settings-system-btn"
                      onClick={() => {
                        if (confirm(t("settings.restartConfirm"))) {
                          api.restartSystem().catch(() => {});
                        }
                      }}
                    >
                      {t("settings.restart")}
                    </button>
                    <button
                      className="settings-system-btn settings-system-btn-danger"
                      onClick={() => {
                        if (confirm(t("settings.shutdownConfirm"))) {
                          api.shutdownSystem().catch(() => {});
                        }
                      }}
                    >
                      {t("settings.shutdown")}
                    </button>
                  </div>
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
                  <h4 className="settings-card-title">{t("settings.diaperDefaults")}</h4>
                  <FormField label={t("settings.defaultDiaperColor")}>
                    <FormSelect
                      options={[
                        { value: "", label: t("settings.diaperColorNone") },
                        { value: "black", label: t("diaper.black") },
                        { value: "brown", label: t("diaper.brown") },
                        { value: "green", label: t("diaper.green") },
                        { value: "yellow", label: t("diaper.yellow") },
                      ]}
                      value={prefs.defaults.diaper?.color || ""}
                      onChange={(e) => setFormDefault("diaper", "color", e.target.value)}
                    />
                  </FormField>
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

                {/* Tags — available to all authenticated users */}
                <TagsSection />

                {/* Backups (admin only) */}
                {isAdmin && (
                  <>
                    <BackupDestinationsSection />
                    <BackupSection />
                  </>
                )}
              </div>
            )}

            {/* Integrations */}
            {section === "integrations" && (
              <div className="settings-section">
                <h3 className="settings-section-title">{t("settings.integrations")}</h3>
                {isAdmin ? (
                  <>
                    <APITokensSection />
                    <WebhooksSection />
                  </>
                ) : (
                  <div className="settings-card" style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
                    {t("settings.adminOnly")}
                  </div>
                )}
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

// Preset cron expressions we surface as one-click buttons. The raw field is
// still editable for power users — cron validation happens server-side.
const SCHEDULE_PRESETS = [
  { value: "",              labelKey: "settings.schedOff" },
  { value: "0 * * * *",     labelKey: "settings.schedHourly" },
  { value: "0 */6 * * *",   labelKey: "settings.sched6h" },
  { value: "0 */12 * * *",  labelKey: "settings.sched12h" },
  { value: "0 3 * * *",     labelKey: "settings.schedDaily" },
  { value: "0 3 * * 0",     labelKey: "settings.schedWeekly" },
];

// describeSchedule renders a short natural-language description for common
// cron patterns. Unknown patterns fall through to the raw expression so users
// still see something meaningful.
function describeSchedule(expr, t) {
  const normalized = expr.trim().replace(/\s+/g, " ");
  const match = SCHEDULE_PRESETS.find((p) => p.value === normalized);
  if (match && match.value) return t(match.labelKey + "Desc");
  return t("settings.schedCustomDesc").replace("{expr}", normalized);
}

// TLSVerificationField lets the user pick between strict chain validation
// (default), pinning a specific certificate (fetched live from the server so
// the user doesn't have to know how to export a PEM), and skipping
// verification entirely (LAN-only fallback).
function TLSVerificationField({ url, mode, setMode, pinnedMeta, setPinnedCertPEM, setPinnedMeta, fetching, setFetching }) {
  const { t } = useI18n();

  const handleFetch = async () => {
    if (!url || !url.startsWith("https://")) {
      alert(t("settings.tlsFetchNeedsHTTPS"));
      return;
    }
    setFetching(true);
    try {
      const info = await api.inspectDestinationCert(url);
      // Show a confirmation with the fingerprint/subject/expiry and let the
      // user accept or abort. The server-stored config will only receive the
      // PEM if they click "trust".
      const msg = t("settings.tlsConfirmTrust")
        .replace("{subject}", info.subject)
        .replace("{issuer}", info.issuer)
        .replace("{notAfter}", new Date(info.not_after).toLocaleDateString())
        .replace("{fingerprint}", info.sha256_fingerprint);
      if (confirm(msg)) {
        setPinnedCertPEM(info.pem);
        setPinnedMeta({
          mode: "pin",
          subject: info.subject,
          fingerprint: info.sha256_fingerprint,
          not_after: info.not_after,
        });
        setMode("pin");
      }
    } catch (e) {
      alert(t("settings.tlsFetchFailed") + "\n" + (e?.error || e?.message || ""));
    }
    setFetching(false);
  };

  return (
    <FormField label={t("settings.destTLSVerification")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="radio" name="tls-mode" checked={mode === "strict"} onChange={() => setMode("strict")} style={{ marginTop: 3 }} />
          <span>
            <strong>{t("settings.tlsStrict")}</strong>
            <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{t("settings.tlsStrictHint")}</div>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="radio" name="tls-mode" checked={mode === "pin"} onChange={() => setMode("pin")} style={{ marginTop: 3 }} />
          <span style={{ flex: 1 }}>
            <strong>{t("settings.tlsPin")}</strong>
            <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{t("settings.tlsPinHint")}</div>
            {mode === "pin" && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={handleFetch}
                  disabled={fetching}
                  className="settings-export-item"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {fetching ? "..." : t("settings.tlsFetchCert")}
                </button>
                {pinnedMeta && (
                  <div style={{ marginTop: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}>
                    <div style={{ fontWeight: 500 }}>{pinnedMeta.subject}</div>
                    <div style={{ color: "var(--text-dim)", marginTop: 2 }}>
                      {t("settings.tlsExpires")}: {pinnedMeta.not_after ? new Date(pinnedMeta.not_after).toLocaleDateString() : "—"}
                    </div>
                    <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--text-dim)", marginTop: 2, wordBreak: "break-all" }}>
                      {pinnedMeta.fingerprint}
                    </div>
                  </div>
                )}
              </div>
            )}
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="radio" name="tls-mode" checked={mode === "skip"} onChange={() => setMode("skip")} style={{ marginTop: 3 }} />
          <span>
            <strong>{t("settings.tlsSkip")}</strong>
            <div style={{ color: "var(--warning, #b58a00)", fontSize: 12, marginTop: 2 }}>⚠ {t("settings.tlsSkipHint")}</div>
          </span>
        </label>
      </div>
    </FormField>
  );
}

// ScheduleField presents the cron value as a friendly preset picker. The raw
// cron string is only exposed when the user picks "Custom" — that way
// non-technical users never see cron syntax, but power users still have a
// way to enter anything the backend accepts.
function ScheduleField({ value, onChange }) {
  const { t } = useI18n();
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  const matchedPreset = SCHEDULE_PRESETS.find((p) => p.value === normalized);
  // Treat unrecognised expressions as "custom" so the cron input shows for editing.
  const [showCustom, setShowCustom] = useState(!matchedPreset);

  const pickPreset = (presetValue) => {
    setShowCustom(false);
    onChange(presetValue);
  };

  const pickCustom = () => {
    setShowCustom(true);
    // Keep whatever was there; if it was a preset, the user can edit from it.
    if (!normalized) onChange("0 3 * * *");
  };

  const isActive = (v) => !showCustom && normalized === v;

  return (
    <FormField label={t("settings.destSchedule")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
        {SCHEDULE_PRESETS.map((p) => (
          <button
            key={p.value || "off"}
            type="button"
            onClick={() => pickPreset(p.value)}
            style={{
              padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${isActive(p.value) ? "var(--accent, #6366f1)" : "var(--border)"}`,
              background: isActive(p.value) ? "var(--accent, #6366f1)" : "var(--bg)",
              color: isActive(p.value) ? "white" : "var(--text)",
              cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              textAlign: "center",
            }}
          >
            {t(p.labelKey)}
          </button>
        ))}
        <button
          type="button"
          onClick={pickCustom}
          style={{
            padding: "10px 12px", borderRadius: 8,
            border: `1px solid ${showCustom ? "var(--accent, #6366f1)" : "var(--border)"}`,
            background: showCustom ? "var(--accent, #6366f1)" : "var(--bg)",
            color: showCustom ? "white" : "var(--text)",
            cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500,
            textAlign: "center",
          }}
        >
          {t("settings.schedCustom")}
        </button>
      </div>

      {showCustom && (
        <div style={{ marginTop: 8 }}>
          <FormInput
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 3 * * *"
            style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }}
          />
          <p className="settings-hint">{t("settings.destScheduleHint")}</p>
        </div>
      )}

      <p className="settings-hint" style={{ marginTop: showCustom ? 6 : 8, fontWeight: 500 }}>
        {normalized === "" ? t("settings.destScheduleDisabled") : describeSchedule(normalized, t)}
      </p>
    </FormField>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TAG_COLOR_PALETTE = [
  "#e67e22", "#e74c3c", "#6C5CE7", "#3498db",
  "#1abc9c", "#00b894", "#f1c40f", "#95a5a6",
];

function TagsSection() {
  const { t } = useI18n();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLOR_PALETTE[0]);
  const [editing, setEditing] = useState(null); // {id, name, color}

  const refresh = () => {
    setLoading(true);
    api.getTags()
      .then((r) => setTags(r.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      await api.createTag({ name: newName.trim(), color: newColor });
      setNewName("");
      refresh();
    } catch (err) {
      alert(err?.error || t("tags.createFailed"));
    }
  };

  const save = async () => {
    if (!editing?.name?.trim()) return;
    try {
      await api.updateTag(editing.id, { name: editing.name.trim(), color: editing.color });
      setEditing(null);
      refresh();
    } catch (err) {
      alert(err?.error || t("tags.saveFailed"));
    }
  };

  const remove = async (tag) => {
    // Deletion cascades on the backend (entry_tags rows go with it). Warn
    // the user before doing so — the tag disappearing from old entries is
    // the gotcha, especially if they've been tagging meaningfully.
    if (!confirm(t("tags.deleteConfirm").replace("{name}", tag.name))) return;
    try {
      await api.deleteTag(tag.id);
      refresh();
    } catch {
      alert(t("tags.deleteFailed"));
    }
  };

  return (
    <div className="settings-card">
      <h4 className="settings-card-title">{t("tags.title")}</h4>
      <p className="settings-hint">{t("tags.hint")}</p>

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>
          {t("general.loading")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {tags.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 12 }}>
              {t("tags.empty")}
            </div>
          )}
          {tags.map((tag) => (
            <div
              key={tag.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
              }}
            >
              {editing?.id === tag.id ? (
                <>
                  <div style={{ display: "flex", gap: 3 }}>
                    {TAG_COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditing({ ...editing, color: c })}
                        aria-label={`Pick color ${c}`}
                        style={{
                          width: 18, height: 18, borderRadius: "50%",
                          background: c,
                          border: editing.color === c ? "2px solid var(--text)" : "2px solid transparent",
                          cursor: "pointer", padding: 0,
                        }}
                      />
                    ))}
                  </div>
                  <FormInput
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button className="settings-export-item" style={{ padding: "4px 10px" }} onClick={save}>
                    {t("general.save")}
                  </button>
                  <button className="settings-export-item" style={{ padding: "4px 10px" }} onClick={() => setEditing(null)}>
                    {t("general.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 10,
                      background: `${tag.color}22`,
                      color: tag.color,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {tag.name}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    className="settings-export-item"
                    style={{ padding: "4px 10px" }}
                    onClick={() => setEditing({ id: tag.id, name: tag.name, color: tag.color })}
                  >
                    {t("general.edit")}
                  </button>
                  <button className="delete-entry-btn" onClick={() => remove(tag)}>×</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inline create form */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 3 }}>
          {TAG_COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setNewColor(c)}
              aria-label={`Pick color ${c}`}
              style={{
                width: 18, height: 18, borderRadius: "50%",
                background: c,
                border: newColor === c ? "2px solid var(--text)" : "2px solid transparent",
                cursor: "pointer", padding: 0,
              }}
            />
          ))}
        </div>
        <FormInput
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("tags.newPlaceholder")}
          onKeyDown={(e) => e.key === "Enter" && create()}
          style={{ flex: 1 }}
        />
        <button
          className="settings-export-main"
          onClick={create}
          disabled={!newName.trim()}
          style={{ padding: "6px 14px" }}
        >
          {t("tags.addTag")}
        </button>
      </div>
    </div>
  );
}

function BackupDestinationsSection() {
  const { t } = useI18n();
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | destObject
  const [testingId, setTestingId] = useState(null);

  const refresh = () => {
    setLoading(true);
    api.listBackupDestinations()
      .then((res) => setDestinations(res.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleTest = async (id) => {
    setTestingId(id);
    try {
      const res = await api.testBackupDestination(id);
      if (res.ok) alert(t("settings.destTestOk"));
      else alert(t("settings.destTestFail") + "\n" + (res.error || ""));
    } catch (e) {
      alert(t("settings.destTestFail") + "\n" + (e.message || ""));
    }
    setTestingId(null);
  };

  const handleDelete = async (d) => {
    if (!confirm(t("settings.destDeleteConfirm").replace("{name}", d.name))) return;
    try {
      await api.deleteBackupDestination(d.id);
      refresh();
    } catch {
      alert(t("settings.destDeleteFailed"));
    }
  };

  return (
    <div className="settings-card">
      <h4 className="settings-card-title">{t("settings.backupDestinations")}</h4>
      <p className="settings-hint">{t("settings.backupDestinationsHint")}</p>

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("general.loading")}</div>
      ) : destinations.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("settings.noDestinations")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {destinations.map((d) => (
            <div
              key={d.id}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--text)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{d.name}</span>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--border)", color: "var(--text-dim)", textTransform: "uppercase" }}>{d.type}</span>
                    {!d.enabled && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>({t("settings.destDisabled")})</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                    {t("settings.destKeepN").replace("{n}", d.retention_count)}
                    {" · "}
                    {d.auto_backup && d.schedule
                      ? describeSchedule(d.schedule, t)
                      : t("settings.destAutoOff")}
                    {" · "}
                    {d.config?.encryption?.enabled
                      ? (d.config.encryption.passphrase_saved
                          ? t("settings.destEncStored")
                          : t("settings.destEncManual"))
                      : t("settings.destEncOff")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="settings-export-item" style={{ padding: "4px 8px" }} onClick={() => handleTest(d.id)} disabled={testingId === d.id}>
                    {testingId === d.id ? "..." : t("settings.destTest")}
                  </button>
                  <button className="settings-export-item" style={{ padding: "4px 8px" }} onClick={() => setEditing(d)}>
                    {t("general.edit")}
                  </button>
                  <button className="delete-entry-btn" onClick={() => handleDelete(d)}>x</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="settings-export-main" onClick={() => setEditing("new")} style={{ width: "100%" }}>
        {t("settings.addDestination")}
      </button>

      {editing && (
        <DestinationEditor
          destination={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function DestinationEditor({ destination, onClose, onSaved }) {
  const { t } = useI18n();
  const isNew = !destination;
  const [name, setName] = useState(destination?.name || "");
  const [type, setType] = useState(destination?.type || "local");
  const [path, setPath] = useState(destination?.config?.path || "");
  const [url, setUrl] = useState(destination?.config?.url || "");
  const [username, setUsername] = useState(destination?.config?.username || "");
  const [password, setPassword] = useState("");
  const [directory, setDirectory] = useState(destination?.config?.directory || "");
  // TLS verification: "strict" (valid chain) | "pin" (trust a specific cert) | "skip" (no validation).
  // Pin mode carries a PEM that was obtained via the inspect-cert endpoint.
  const [tlsMode, setTlsMode] = useState(destination?.config?.tls?.mode || "strict");
  const [pinnedCertPEM, setPinnedCertPEM] = useState("");
  const [pinnedCertMeta, setPinnedCertMeta] = useState(destination?.config?.tls?.mode === "pin" ? destination.config.tls : null);
  const [fetchingCert, setFetchingCert] = useState(false);
  const [retention, setRetention] = useState(destination?.retention_count ?? 7);
  const [autoBackup, setAutoBackup] = useState(destination?.auto_backup ?? true);
  const [enabled, setEnabled] = useState(destination?.enabled ?? true);
  const [schedule, setSchedule] = useState(destination?.schedule ?? "0 3 * * *");
  const encInitiallyOn = !!destination?.config?.encryption?.enabled;
  const passInitiallySaved = !!destination?.config?.encryption?.passphrase_saved;
  const [encEnabled, setEncEnabled] = useState(encInitiallyOn);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [savePassphrase, setSavePassphrase] = useState(passInitiallySaved);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { alert(t("settings.destNameRequired")); return; }
    if (type === "webdav" && !url.trim()) { alert(t("settings.destUrlRequired")); return; }
    // Passphrase must be provided AND confirmed whenever we're about to store
    // a new one — either first-time enable, or re-keying an encrypted dest.
    const isNewPassphrase = encEnabled && (!encInitiallyOn || passphrase);
    if (encEnabled && !encInitiallyOn && !passphrase) { alert(t("settings.destPassRequired")); return; }
    if (isNewPassphrase && passphrase !== passphraseConfirm) { alert(t("settings.destPassMismatch")); return; }
    if (encEnabled && !encInitiallyOn && !confirm(t("settings.destEncWarn"))) return;

    const config = type === "local"
      ? { path: path.trim() }
      : {
          url: url.trim(),
          username: username.trim(),
          directory: directory.trim(),
          ...(password ? { password } : {}),
          tls_mode: tlsMode,
          // Only send the PEM when (re-)pinning in this save — the server
          // keeps the existing pinned cert if tls_mode isn't touched.
          ...(tlsMode === "pin" && pinnedCertPEM ? { pinned_cert_pem: pinnedCertPEM } : {}),
        };

    const payload = {
      name: name.trim(),
      type,
      config,
      retention_count: parseInt(retention, 10) || 7,
      auto_backup: autoBackup,
      enabled,
      schedule: schedule.trim(),
    };

    // Encryption transitions
    if (!encEnabled && encInitiallyOn) {
      payload.disable_encryption = true;
    } else if (encEnabled && !encInitiallyOn) {
      payload.enable_encryption = true;
      payload.passphrase = passphrase;
      payload.save_passphrase = savePassphrase;
    } else if (encEnabled && encInitiallyOn && passphrase) {
      // Re-key with a new passphrase
      payload.enable_encryption = true;
      payload.passphrase = passphrase;
      payload.save_passphrase = savePassphrase;
    }

    setSaving(true);
    try {
      if (isNew) await api.createBackupDestination(payload);
      else await api.updateBackupDestination(destination.id, payload);
      onSaved();
    } catch (e) {
      alert((e && e.error) || t("settings.destSaveFailed"));
      setSaving(false);
    }
  };

  return (
    <div className="settings-overlay" style={{ zIndex: 1100 }}>
      <div className="settings-page" style={{ maxWidth: 520, width: "100%" }}>
        <div className="settings-header">
          <h2>{isNew ? t("settings.addDestination") : t("settings.editDestination")}</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>
        <div className="settings-content" style={{ padding: 16, overflowY: "auto" }}>
          <FormField label={t("settings.destName")}>
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Nextcloud" />
          </FormField>
          {isNew && (
            <FormField label={t("settings.destType")}>
              <FormSelect
                value={type}
                onChange={(e) => setType(e.target.value)}
                options={[
                  { value: "local", label: t("settings.destTypeLocal") },
                  { value: "webdav", label: t("settings.destTypeWebDAV") },
                ]}
              />
            </FormField>
          )}

          {type === "local" && (
            <FormField label={t("settings.destPath")}>
              <FormInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="/mnt/usb/babytracker" />
              <p className="settings-hint">{t("settings.destPathHint")}</p>
            </FormField>
          )}

          {type === "webdav" && (
            <>
              <FormField label={t("settings.destURL")}>
                <FormInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example.com/remote.php/dav/files/USER/" />
                <p className="settings-hint">{t("settings.destURLHint")}</p>
              </FormField>
              <FormField label={t("settings.destUsername")}>
                <FormInput value={username} onChange={(e) => setUsername(e.target.value)} />
              </FormField>
              <FormField label={t("settings.destPassword")}>
                <FormInput type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={!isNew && destination?.config?.password_set ? t("settings.destPasswordKeep") : ""} />
              </FormField>
              <FormField label={t("settings.destDirectory")}>
                <FormInput value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="BabyTracker/backups" />
              </FormField>

              <TLSVerificationField
                url={url}
                mode={tlsMode}
                setMode={setTlsMode}
                pinnedMeta={pinnedCertMeta}
                setPinnedCertPEM={setPinnedCertPEM}
                setPinnedMeta={setPinnedCertMeta}
                fetching={fetchingCert}
                setFetching={setFetchingCert}
              />
            </>
          )}

          <FormField label={t("settings.destRetention")}>
            <FormInput type="number" min="1" value={retention} onChange={(e) => setRetention(e.target.value)} />
            <p className="settings-hint">{t("settings.destRetentionHint")}</p>
          </FormField>

          <ScheduleField value={schedule} onChange={setSchedule} />


          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: 14, color: "var(--text)" }}>
            <input type="checkbox" checked={autoBackup} onChange={(e) => setAutoBackup(e.target.checked)} />
            {t("settings.destAutoBackup")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: 14, color: "var(--text)" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("settings.destEnabled")}
          </label>

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--text)" }}>
              <input type="checkbox" checked={encEnabled} onChange={(e) => setEncEnabled(e.target.checked)} />
              {t("settings.destEncryption")}
            </label>
            {encEnabled && (
              <div style={{ marginTop: 8 }}>
                <FormField label={encInitiallyOn ? t("settings.destNewPassphrase") : t("settings.destPassphrase")}>
                  <FormInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={encInitiallyOn ? t("settings.destPassphraseKeep") : ""} autoComplete="new-password" />
                </FormField>
                {(passphrase || !encInitiallyOn) && (
                  <FormField label={t("settings.destPassphraseConfirm")}>
                    <FormInput type="password" value={passphraseConfirm}
                      onChange={(e) => setPassphraseConfirm(e.target.value)} autoComplete="new-password" />
                    {passphraseConfirm && passphrase !== passphraseConfirm && (
                      <p className="settings-hint" style={{ color: "var(--danger, #dc2626)" }}>
                        {t("settings.destPassMismatch")}
                      </p>
                    )}
                  </FormField>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", fontSize: 13, color: "var(--text)" }}>
                  <input type="checkbox" checked={savePassphrase} onChange={(e) => setSavePassphrase(e.target.checked)} />
                  {t("settings.destSavePassphrase")}
                </label>
                <p className="settings-hint" style={{ color: "var(--warning, #b58a00)" }}>
                  ⚠ {t("settings.destEncWarnInline")}
                </p>
                {savePassphrase && (
                  <p className="settings-hint" style={{ color: "var(--warning, #b58a00)" }}>
                    ⚠ {t("settings.destSavePassWarn")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--border)" }}>
          <FormButton onClick={onClose} color="var(--border)" style={{ flex: 1 }}>{t("general.cancel")}</FormButton>
          <FormButton onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? t("general.saving") : t("general.save")}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

function BackupSection() {
  const { t } = useI18n();
  const [backups, setBackups] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreModal, setRestoreModal] = useState(null); // {backup, destinationId}

  const refresh = () => {
    Promise.all([api.getBackups(), api.listBackupDestinations()])
      .then(([backupsRes, destsRes]) => {
        setBackups(backupsRes.results || []);
        setDestinations(destsRes.results || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(t("settings.restoreConfirm"))) {
      e.target.value = "";
      return;
    }
    let passphrase = "";
    if (file.name.endsWith(".enc")) {
      passphrase = prompt(t("settings.restorePassPrompt")) || "";
      if (!passphrase) { e.target.value = ""; return; }
    }
    const wipePhotos = confirm(t("settings.wipePhotosPrompt"));
    setRestoring(true);
    try {
      await api.restoreBackup(file, passphrase, wipePhotos);
      alert(t("settings.restoreOk"));
      window.location.reload();
    } catch (err) {
      alert(t("settings.restoreFailed") + (err?.error ? "\n" + err.error : ""));
    }
    setRestoring(false);
    e.target.value = "";
  };

  return (
    <div className="settings-card">
      <h4 className="settings-card-title">{t("settings.backups")}</h4>
      <p className="settings-hint" style={{ marginBottom: 16 }}>{t("settings.backupEnabledHintMulti")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className="settings-export-main"
          onClick={() => setCreateOpen(true)}
          disabled={creating || destinations.length === 0}
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
            accept=".gz,.enc,application/gzip,application/octet-stream"
            style={{ display: "none" }}
            onChange={handleRestoreFile}
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
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--text)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{formatBackupDate(b.date)}</span>
                    {b.encrypted && (
                      <span title={t("settings.encryptedBackup")} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--accent, #6366f1)", color: "white" }}>
                        🔒 {t("settings.encrypted")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                    {formatBytes(b.size)} · {(b.destinations || []).map((d) => d.name).join(", ")}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {(b.destinations || []).map((d) => (
                  <BackupActionMenu key={d.id} backup={b} destination={d} onChange={refresh} onRestore={() => setRestoreModal({ backup: b, destinationId: d.id })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateBackupModal
          destinations={destinations}
          onClose={() => setCreateOpen(false)}
          onCreating={setCreating}
          onCreated={() => { setCreateOpen(false); refresh(); }}
        />
      )}
      {restoreModal && (
        <RemoteRestoreModal
          backup={restoreModal.backup}
          destinationId={restoreModal.destinationId}
          onClose={() => setRestoreModal(null)}
          onRestored={() => { setRestoreModal(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function BackupActionMenu({ backup, destination, onChange, onRestore }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}>
      <span style={{ color: "var(--text-dim)" }}>{destination.name}:</span>
      <button
        className="settings-export-item"
        style={{ padding: "2px 6px", fontSize: 11 }}
        onClick={() => api.downloadBackup(backup.name, destination.id).catch(() => alert(t("settings.downloadFailed")))}
      >
        {t("settings.download")}
      </button>
      <button
        className="settings-export-item"
        style={{ padding: "2px 6px", fontSize: 11 }}
        onClick={onRestore}
      >
        {t("settings.restore")}
      </button>
      <button
        className="delete-entry-btn"
        style={{ padding: "2px 6px", fontSize: 11 }}
        onClick={async () => {
          if (!confirm(t("settings.deleteBackupConfirm"))) return;
          try {
            await api.deleteBackup(backup.name, destination.id);
            onChange();
          } catch {
            alert(t("settings.deleteFailed"));
          }
        }}
      >×</button>
    </div>
  );
}

function CreateBackupModal({ destinations, onClose, onCreating, onCreated }) {
  const { t } = useI18n();
  const remembered = (() => {
    try { return JSON.parse(localStorage.getItem("babytracker_backup_dests") || "[]"); } catch { return []; }
  })();
  const initial = destinations.filter((d) => d.enabled).map((d) => d.id);
  const startSelected = remembered.length ? remembered.filter((id) => initial.includes(id)) : initial;
  const [selected, setSelected] = useState(new Set(startSelected.length ? startSelected : initial));
  const [passphrases, setPassphrases] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { alert(t("settings.selectAtLeastOne")); return; }
    // Validate passphrases needed
    const needsPass = destinations.filter((d) => selected.has(d.id) && d.config?.encryption?.enabled && !d.config?.encryption?.passphrase_saved);
    for (const d of needsPass) {
      if (!passphrases[d.id]) { alert(t("settings.passphraseRequiredFor").replace("{name}", d.name)); return; }
    }
    setSubmitting(true);
    onCreating(true);
    try {
      const payloadPass = {};
      needsPass.forEach((d) => { payloadPass[d.id] = passphrases[d.id]; });
      const res = await api.createBackup(ids, payloadPass);
      localStorage.setItem("babytracker_backup_dests", JSON.stringify(ids));
      const errors = (res.results || []).filter((r) => r.error);
      if (errors.length) alert(t("settings.backupPartial") + "\n" + errors.map((e) => `${e.destination || "?"}: ${e.error}`).join("\n"));
      onCreated();
    } catch (e) {
      alert(t("settings.backupFailed") + (e?.error ? "\n" + e.error : ""));
      setSubmitting(false);
    }
    onCreating(false);
  };

  return (
    <div className="settings-overlay" style={{ zIndex: 1100 }}>
      <div className="settings-page" style={{ maxWidth: 480, width: "100%" }}>
        <div className="settings-header">
          <h2>{t("settings.createBackup")}</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>
        <div className="settings-content" style={{ padding: 16, overflowY: "auto" }}>
          <p className="settings-hint">{t("settings.selectDestinations")}</p>
          {destinations.filter((d) => d.enabled).map((d) => {
            const enc = d.config?.encryption?.enabled;
            const stored = d.config?.encryption?.passphrase_saved;
            const isChecked = selected.has(d.id);
            return (
              <div key={d.id} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", color: "var(--text)" }}>
                  <input type="checkbox" checked={isChecked} onChange={() => toggle(d.id)} />
                  <span style={{ fontWeight: 500 }}>{d.name}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--border)", color: "var(--text-dim)", textTransform: "uppercase" }}>{d.type}</span>
                  {enc && <span style={{ fontSize: 10 }}>🔒</span>}
                </label>
                {isChecked && enc && !stored && (
                  <FormField label={t("settings.passphrase")}>
                    <FormInput type="password" value={passphrases[d.id] || ""}
                      onChange={(e) => setPassphrases((p) => ({ ...p, [d.id]: e.target.value }))} />
                  </FormField>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--border)" }}>
          <FormButton onClick={onClose} color="var(--border)" style={{ flex: 1 }}>{t("general.cancel")}</FormButton>
          <FormButton onClick={submit} disabled={submitting} style={{ flex: 1 }}>
            {submitting ? t("settings.creating") : t("settings.createBackup")}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

function RemoteRestoreModal({ backup, destinationId, onClose, onRestored }) {
  const { t } = useI18n();
  const [passphrase, setPassphrase] = useState("");
  const [wipePhotos, setWipePhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!confirm(t("settings.restoreConfirm"))) return;
    if (backup.encrypted && !passphrase) { alert(t("settings.passphraseRequired")); return; }
    setSubmitting(true);
    try {
      await api.restoreBackupFromDestination(destinationId, backup.name, passphrase, wipePhotos);
      alert(t("settings.restoreOk"));
      onRestored();
    } catch (e) {
      alert(t("settings.restoreFailed") + (e?.error ? "\n" + e.error : ""));
      setSubmitting(false);
    }
  };

  return (
    <div className="settings-overlay" style={{ zIndex: 1100 }}>
      <div className="settings-page" style={{ maxWidth: 420, width: "100%" }}>
        <div className="settings-header">
          <h2>{t("settings.restore")}</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>
        <div className="settings-content" style={{ padding: 16 }}>
          <p style={{ color: "var(--text)", fontSize: 14 }}>{backup.name}</p>
          <p className="settings-hint" style={{ color: "var(--warning, #b58a00)" }}>⚠ {t("settings.restoreWarn")}</p>
          {backup.encrypted && (
            <FormField label={t("settings.passphrase")}>
              <FormInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </FormField>
          )}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 13, color: "var(--text)" }}>
            <input type="checkbox" checked={wipePhotos} onChange={(e) => setWipePhotos(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <strong>{t("settings.wipePhotosLabel")}</strong>
              <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{t("settings.wipePhotosHint")}</div>
            </span>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid var(--border)" }}>
          <FormButton onClick={onClose} color="var(--border)" style={{ flex: 1 }}>{t("general.cancel")}</FormButton>
          <FormButton onClick={submit} disabled={submitting} style={{ flex: 1 }}>
            {submitting ? t("settings.restoring") : t("settings.restore")}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

function DomainSection() {
  const { t } = useI18n();
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getDomain()
      .then((data) => { setDomain(data.domain || ""); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const data = await api.setDomain(domain.trim());
      setMessage({ type: "success", text: data.message || t("settings.domainSaved") });
    } catch (err) {
      setMessage({ type: "error", text: err.message || t("settings.domainError") });
    }
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div className="settings-card" style={{ marginTop: 16 }}>
      <h4 className="settings-section-subtitle">{t("settings.customDomain")}</h4>
      <p className="settings-hint">{t("settings.customDomainHint")}</p>
      <FormField label={t("settings.domainLabel")}>
        <FormInput
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="baby.example.com"
        />
      </FormField>
      {domain.trim() && (
        <p className="settings-hint" style={{ color: "#e17055", fontSize: 11 }}>
          {t("settings.domainPortWarning")}
        </p>
      )}
      {message && (
        <p className="settings-hint" style={{ color: message.type === "success" ? "#00b894" : "#e74c3c" }}>
          {message.text}
        </p>
      )}
      <FormButton color="#6C5CE7" disabled={saving} onClick={handleSave}>
        {saving ? t("form.saving") : t("settings.saveDomain")}
      </FormButton>
    </div>
  );
}

const DNS_PROVIDERS = [
  { value: "", label: "None (self-signed)" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "route53", label: "AWS Route53" },
  { value: "duckdns", label: "DuckDNS" },
  { value: "namecheap", label: "Namecheap" },
  { value: "simply", label: "Simply.com" },
];

const PROVIDER_FIELDS = {
  cloudflare: [{ key: "CF_DNS_API_TOKEN", label: "API Token" }],
  route53: [
    { key: "AWS_ACCESS_KEY_ID", label: "Access Key ID" },
    { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key" },
    { key: "AWS_HOSTED_ZONE_ID", label: "Hosted Zone ID (optional)", optional: true },
  ],
  duckdns: [{ key: "DUCKDNS_TOKEN", label: "Token" }],
  namecheap: [
    { key: "NAMECHEAP_API_USER", label: "API User" },
    { key: "NAMECHEAP_API_KEY", label: "API Key" },
  ],
  simply: [
    { key: "SIMPLY_ACCOUNT_NAME", label: "Account Name" },
    { key: "SIMPLY_API_KEY", label: "API Key" },
  ],
};

function TLSSection() {
  const [provider, setProvider] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState({});
  const [credentialsSet, setCredentialsSet] = useState(false);
  const [manageA, setManageA] = useState(true);
  const [ip, setIp] = useState("");
  const [certInfo, setCertInfo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getTLS()
      .then((data) => {
        setProvider(data.provider || "");
        setDomain(data.domain || "");
        setEmail(data.email || "");
        setCredentialsSet(data.credentials_set || false);
        setManageA(data.manage_a !== false);
        setIp(data.ip || "");
        if (data.certificate) setCertInfo(data.certificate);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = { domain: domain.trim(), email: email.trim(), provider, manage_a: manageA, ip: ip.trim() };
      // Only send credentials if the user entered new ones
      const hasNewCreds = Object.values(credentials).some((v) => v);
      if (hasNewCreds) payload.credentials = credentials;
      const data = await api.setTLS(payload);
      if (data.error) {
        setMessage({ type: "error", text: data.message || data.error });
      } else {
        setMessage({ type: "success", text: data.message || "Saved" });
        if (data.certificate) setCertInfo(data.certificate);
        setCredentialsSet(true);
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Failed to save" });
    }
    setSaving(false);
  };

  const updateCred = (key, value) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  if (!loaded) return null;

  const fields = PROVIDER_FIELDS[provider] || [];

  return (
    <div className="settings-card" style={{ marginTop: 16 }}>
      <h4 className="settings-section-subtitle">TLS / HTTPS Certificate</h4>
      <p className="settings-hint">
        Get a valid TLS certificate from Let's Encrypt using DNS validation.
        Works behind NAT — no port forwarding needed.
      </p>

      <FormField label="DNS Provider">
        <select
          className="form-select"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setCredentials({});
            setCredentialsSet(false);
          }}
        >
          {DNS_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </FormField>

      {provider && (
        <>
          <FormField label="Domain">
            <FormInput
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="baby.example.com"
            />
          </FormField>

          <FormField label="Email (for expiry notices)">
            <FormInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={"admin@" + (domain || "example.com")}
            />
          </FormField>

          {fields.map((f) => (
            <FormField key={f.key} label={f.label}>
              <FormInput
                type="password"
                value={credentials[f.key] || ""}
                onChange={(e) => updateCred(f.key, e.target.value)}
                placeholder={credentialsSet ? "••••••••  (saved)" : ""}
              />
            </FormField>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              id="manage-a-record"
              checked={manageA}
              onChange={(e) => setManageA(e.target.checked)}
            />
            <label htmlFor="manage-a-record" style={{ fontSize: 13 }}>
              Manage DNS A record (point domain to this server)
            </label>
          </div>

          {manageA && (
            <FormField label="IP address (leave empty to auto-detect)">
              <FormInput
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Auto-detect LAN IP"
              />
            </FormField>
          )}

          {certInfo && (
            <div className="settings-hint" style={{ color: "#00b894", marginTop: 8 }}>
              ✓ Certificate valid until {new Date(certInfo.expires).toLocaleDateString()}
              {certInfo.issuer && ` (${certInfo.issuer})`}
            </div>
          )}

          {message && (
            <p className="settings-hint" style={{ color: message.type === "success" ? "#00b894" : "#e74c3c" }}>
              {message.text}
            </p>
          )}

          <FormButton color="#6C5CE7" disabled={saving || !domain.trim()} onClick={handleSave}>
            {saving ? "Obtaining certificate..." : certInfo ? "Update Certificate" : "Save & Obtain Certificate"}
          </FormButton>
        </>
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

function APITokensSection() {
  const { t } = useI18n();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState("read");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const refresh = () => {
    api.getAPITokens()
      .then((data) => setTokens(data.results || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await api.createAPIToken({ name, permissions });
      setNewToken(result.token);
      setName("");
      setShowCreate(false);
      refresh();
    } catch {
      setCreating(false);
    }
    setCreating(false);
  };

  return (
    <div className="settings-card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 className="settings-card-title" style={{ margin: 0 }}>{t("settings.apiTokens")}</h4>
        <button
          onClick={() => { setShowCreate(!showCreate); setNewToken(null); }}
          style={{ fontSize: 12, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          {showCreate ? t("users.cancel") : t("settings.createToken")}
        </button>
      </div>
      <p className="settings-hint">{t("settings.apiTokensHint")}</p>

      {newToken && (
        <div style={{ background: "#00b89418", border: "1px solid #00b89440", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#00b894", marginBottom: 4 }}>{t("settings.tokenCreated")}</div>
          <code style={{ fontSize: 12, wordBreak: "break-all", color: "var(--text)" }}>{newToken}</code>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{t("settings.tokenCopyWarning")}</div>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: 12 }}>
          <FormField label={t("settings.tokenName")}>
            <FormInput type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Home Assistant" />
          </FormField>
          <FormField label={t("settings.tokenPermissions")}>
            <FormSelect
              value={permissions}
              onChange={(e) => setPermissions(e.target.value)}
              options={[
                { value: "read", label: t("settings.tokenRead") },
                { value: "read_write", label: t("settings.tokenReadWrite") },
              ]}
            />
          </FormField>
          <FormButton color="#6C5CE7" disabled={creating}>
            {creating ? t("users.creating") : t("settings.createToken")}
          </FormButton>
        </form>
      )}

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("general.loading")}</div>
      ) : tokens.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("settings.noTokens")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {tokens.map((tk) => (
            <div key={tk.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 6, background: "var(--card-bg)", fontSize: 12 }}>
              <div>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>{tk.name}</span>
                <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>{tk.permissions}</span>
              </div>
              <button
                className="delete-entry-btn"
                style={{ fontSize: 11 }}
                onClick={async () => {
                  if (confirm(t("settings.deleteTokenConfirm"))) {
                    await api.deleteAPIToken(tk.id);
                    refresh();
                  }
                }}
              >
                {t("users.revoke")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhooksSection() {
  const { t } = useI18n();
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState("*");
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    api.getWebhooks()
      .then((data) => setWebhooks(data.results || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createWebhook({ name, url, secret, events, active: true });
      setName(""); setUrl(""); setSecret(""); setEvents("*");
      setShowCreate(false);
      refresh();
    } catch { /* ignore */ }
    setCreating(false);
  };

  return (
    <div className="settings-card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 className="settings-card-title" style={{ margin: 0 }}>{t("settings.webhooks")}</h4>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{ fontSize: 12, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          {showCreate ? t("users.cancel") : t("settings.addWebhook")}
        </button>
      </div>
      <p className="settings-hint">{t("settings.webhooksHint")}</p>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: 12 }}>
          <FormField label={t("settings.webhookName")}>
            <FormInput type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Notify on feeding" />
          </FormField>
          <FormField label={t("settings.webhookUrl")}>
            <FormInput type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://example.com/webhook" />
          </FormField>
          <FormField label={t("settings.webhookSecret")}>
            <FormInput type="text" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t("form.optional")} />
          </FormField>
          <FormField label={t("settings.webhookEvents")}>
            <FormInput type="text" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="* (all events)" />
          </FormField>
          <FormButton color="#6C5CE7" disabled={creating}>
            {creating ? t("users.creating") : t("settings.addWebhook")}
          </FormButton>
        </form>
      )}

      {loading ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("general.loading")}</div>
      ) : webhooks.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 16 }}>{t("settings.noWebhooks")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {webhooks.map((wh) => (
            <div key={wh.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 6, background: "var(--card-bg)", fontSize: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{wh.name}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wh.url}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: wh.active ? "#00b89418" : "#e74c3c18",
                  color: wh.active ? "#00b894" : "#e74c3c",
                }}>
                  {wh.active ? t("settings.webhookActive") : t("settings.webhookInactive")}
                </span>
                <button
                  className="delete-entry-btn"
                  style={{ fontSize: 11 }}
                  onClick={async () => {
                    if (confirm(t("settings.deleteWebhookConfirm"))) {
                      await api.deleteWebhook(wh.id);
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
