import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { useI18n } from "../utils/i18n";

// Nara's brand orange, for icons; buttons use a darker shade so white text
// on them stays readable (4.5:1).
const ACCENT = "#e17055";
const ACCENT_BUTTON = "#b4492f";

// The server's stats keys, in display order, with the existing labels the
// app already uses for each entry type.
const STAT_LABELS = [
  ["feedings", "export.feedings"],
  ["sleep", "export.sleep"],
  ["changes", "export.changes"],
  ["pumping", "feature.pumping"],
  ["weight", "export.weight"],
  ["height", "export.height"],
  ["head_circumference", "feature.headcirc"],
  ["temperature", "export.temperature"],
  ["medications", "export.medications"],
  ["milestones", "export.milestones"],
  ["notes", "feature.note"],
];

// NaraImport walks an admin through importing a Nara Baby CSV export: pick
// the file, see what's in it (the baby's details are prefilled from the
// export's profile row), choose the units to save amounts in, then import
// into a new child and review what came across.
//
// unitSystem seeds the unit choice (the device's setting); on import the
// choice is passed to onUnitsChange so this device then shows the units the
// amounts were saved in. onBusy(true) is called while the new child exists
// but the summary hasn't been dismissed, so a background refresh doesn't swap
// the screen out from under it. doneLabel names the summary's button.
export default function NaraImport({ unitSystem, onUnitsChange, onDone, onBack, onBusy, doneLabel }) {
  const { t } = useI18n();
  const ids = useId();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [units, setUnits] = useState(unitSystem === "imperial" ? "imperial" : "metric");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const previewSeq = useRef(0);
  // What the last export's profile filled in, so a newly picked export can
  // replace it without overwriting anything the user typed.
  const prefilled = useRef({ name: "", birth_date: "", sex: "" });

  // Release the hold if this goes away mid-import (it shouldn't: Back is
  // disabled while importing).
  useEffect(() => () => onBusy?.(false), [onBusy]);

  const errorText = (err) => {
    if (err?.status === 413) return t("nara.error.too_large", { detail: err.detail || "50" });
    if (err?.status === 401) return t("nara.error.session_expired");
    if (err?.code) {
      const key = `nara.error.${err.code}`;
      const text = t(key, { detail: err.detail || "" });
      if (text !== key) return text;
    }
    // A failed fetch (offline, dropped connection) or a timeout; anything
    // else without a code (proxy pages, rate limits) gets the generic text.
    if (err instanceof TypeError || /timed out/i.test(err?.message || "")) return t("nara.error.network");
    return t("nara.error.generic");
  };

  const runPreview = async (picked, system) => {
    const seq = ++previewSeq.current;
    setPreview(null);
    setError("");
    setChecking(true);
    try {
      const res = await api.previewNaraImport(picked, system);
      if (seq !== previewSeq.current) return;
      if (!res || !res.stats) throw new Error("empty response");
      setPreview(res);
      const p = res.profile || {};
      const last = prefilled.current;
      const fill = (current, prev, next, set) => {
        if (current === "" || current === prev) set(next || "");
      };
      fill(firstName, last.name, p.name, setFirstName);
      fill(birthDate, last.birth_date, p.birth_date, setBirthDate);
      fill(sex, last.sex, p.sex, setSex);
      prefilled.current = { name: p.name || "", birth_date: p.birth_date || "", sex: p.sex || "" };
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setFile(null);
      setError(errorText(err));
    } finally {
      if (seq === previewSeq.current) setChecking(false);
    }
  };

  const handleFile = (e) => {
    const picked = e.target.files?.[0] || null;
    e.target.value = ""; // let the same file be picked again after a fix
    if (!picked) return;
    setFile(picked);
    setIncludeDuplicates(false);
    runPreview(picked, units);
  };

  const handleUnits = (e) => {
    setUnits(e.target.value);
    if (file) runPreview(file, e.target.value);
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!file || !preview || checking) return;
    setError("");
    setImporting(true);
    onBusy?.(true);
    try {
      const res = await api.importFromNara(file, { firstName, lastName, birthDate, sex, unitSystem: units, includeDuplicates });
      if (!res || !res.stats) throw new Error("empty response");
      setResult(res);
      onUnitsChange?.(units);
    } catch (err) {
      onBusy?.(false);
      setError(errorText(err));
      setImporting(false);
    }
  };

  const finish = async () => {
    try {
      await onDone?.(result);
    } finally {
      onBusy?.(false);
    }
  };

  if (result) {
    return (
      <Card>
        <div className="login-header" style={{ marginBottom: 20 }}>
          <div className="login-icon" style={{ background: "#00b89418", color: "#00b894" }}><Icons.Activity /></div>
          <h1 className="login-title">{t("onboarding.importComplete")}</h1>
        </div>
        <Summary data={result} />
        <button onClick={finish} className="login-button" style={{ background: colors.feeding, width: "100%" }}>
          {doneLabel || t("onboarding.continueToDashboard")}
        </button>
      </Card>
    );
  }

  const duplicates = preview?.duplicate_pumping?.count || 0;
  const importable = total(preview?.stats) + (includeDuplicates ? duplicates : 0);
  const nothingToImport = preview && importable === 0 && duplicates === 0;

  return (
    <Card>
      <div className="login-header">
        <div className="login-icon" style={{ background: `${ACCENT}18`, color: ACCENT }}><Icons.Download /></div>
        <h1 className="login-title">{t("onboarding.importNara")}</h1>
        <p className="login-subtitle">{t("onboarding.naraHint")}</p>
      </div>
      <form onSubmit={handleImport} className="login-form">
        {error && <div className="login-error" role="alert">{error}</div>}
        <label className="file-picker" style={{ color: importing ? "var(--text-dim)" : "var(--text-muted)", cursor: importing ? "not-allowed" : "pointer" }}>
          <span style={{ flexShrink: 0, display: "flex" }}><Icons.Download /></span>
          <span>
            {t("nara.chooseFile")}
            {file && <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>{file.name}</span>}
          </span>
          <input
            type="file"
            className="visually-hidden"
            // text/* as well: Android WebView hosts (e.g. the Home Assistant
            // app) grey out .csv files whose type is text/comma-separated-values.
            accept=".csv,text/csv,text/*"
            onChange={handleFile}
            // Not disabled while the preview runs, so focus stays here; a
            // newer pick simply replaces the older one.
            disabled={importing}
          />
        </label>

        <div className="login-field">
          <label className="login-label" htmlFor={`${ids}-units`}>{t("nara.saveUnits")}</label>
          <select id={`${ids}-units`} className="login-input" value={units} onChange={handleUnits} disabled={importing}>
            <option value="metric">{t("settings.metric")}</option>
            <option value="imperial">{t("settings.imperial")}</option>
          </select>
        </div>

        <div role="status" aria-live="polite">
          {checking && <p className="login-label" style={{ margin: 0 }}>{t("nara.checking")}</p>}
          {preview && (
            <div>
              <div className="login-label" style={{ marginBottom: 6 }}>{t("nara.found")}</div>
              {nothingToImport && (
                <div className="login-error" style={{ textAlign: "left", marginBottom: 8 }}>{t("nara.error.nothing_to_import")}</div>
              )}
              <Summary data={preview} />
            </div>
          )}
        </div>

        {duplicates > 0 && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--text-muted)" }}>
            <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{t("nara.importDuplicates", { count: duplicates })}</span>
          </label>
        )}

        {preview && !nothingToImport && (
          <>
            <div className="login-field">
              <label className="login-label" htmlFor={`${ids}-first`}>{t("onboarding.firstName")}</label>
              <input id={`${ids}-first`} type="text" className="login-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required placeholder="Emma" />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor={`${ids}-last`}>{t("onboarding.lastName")} ({t("form.optional")})</label>
              <input id={`${ids}-last`} type="text" className="login-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor={`${ids}-birth`}>{t("onboarding.birthDate")}</label>
              <input id={`${ids}-birth`} type="date" className="login-input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor={`${ids}-sex`}>{t("onboarding.sex")}</label>
              <select id={`${ids}-sex`} className="login-input" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">{t("onboarding.sexUnspecified")}</option>
                <option value="female">{t("onboarding.sexFemale")}</option>
                <option value="male">{t("onboarding.sexMale")}</option>
              </select>
            </div>
          </>
        )}

        {!nothingToImport && (
          <button type="submit" className="login-button" style={{ background: ACCENT_BUTTON }} disabled={!preview || checking || importing || importable === 0}>
            {importing ? t("onboarding.importing") : t("onboarding.startImport")}
          </button>
        )}
        <button type="button" onClick={onBack} disabled={importing} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: importing ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: 4, padding: 8 }}>
          {t("form.back")}
        </button>
      </form>
    </Card>
  );
}

function Card({ children }) {
  return (
    <div className="login-screen">
      <div className="login-card">{children}</div>
    </div>
  );
}

function total(stats) {
  return Object.values(stats || {}).reduce((sum, n) => sum + (n || 0), 0);
}

// Summary lists what an export holds (preview) or what was imported (result):
// counts per entry type, the units amounts were saved in, what was saved as
// notes or not imported, and rows imported with an assumption or not read.
function Summary({ data }) {
  const { t } = useI18n();
  const counts = STAT_LABELS.filter(([k]) => data.stats?.[k] > 0);
  const skipped = Object.entries(data.skipped || {});
  const asNotes = Object.entries(data.as_notes || {});
  const u = data.units || {};
  const list = (entries) => entries.map(([type, n]) => `${type} (${n})`).join(", ");
  return (
    <div style={{ marginBottom: 16 }}>
      {counts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {counts.map(([key, label]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ color: "var(--text-muted)" }}>{t(label)}</span>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{data.stats[key]}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 8 }}>
        {counts.length > 0 && u.volume && <p style={{ margin: 0 }}>{t("nara.unitsUsed", u)}</p>}
        {data.stats?.sleep > 0 && <p style={{ margin: 0 }}>{t("nara.sleepClassified")}</p>}
        {data.solid_feeds > 0 && <p style={{ margin: 0 }}>{t("nara.solidsParentFed")}</p>}
        {asNotes.length > 0 && <p style={{ margin: 0 }}>{t("nara.asNotes")} {list(asNotes)}</p>}
        {data.duplicate_pumping?.count > 0 && (
          <p style={{ margin: 0 }}>
            {t("nara.duplicatePumping", { count: data.duplicate_pumping.count, children: (data.duplicate_pumping.children || []).join(", ") })}
          </p>
        )}
        {skipped.length > 0 && <p style={{ margin: 0 }}>{t("nara.skipped")} {list(skipped)}</p>}
        <Issues title={t("nara.warnings", { count: data.warning_count })} items={data.warnings} total={data.warning_count} />
        <Issues title={t("nara.rejected", { count: data.rejected_count })} items={data.rejected} total={data.rejected_count} />
      </div>
    </div>
  );
}

function Issues({ title, items, total }) {
  const { t } = useI18n();
  if (!total) return null;
  const list = items || [];
  const reason = (it) => {
    const key = `nara.reason.${it.code}`;
    const text = t(key, { detail: it.detail || "", value: it.value || "" });
    return text !== key ? text : it.reason;
  };
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>{title}</summary>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto" }}>
        {list.map((it, i) => (
          <li key={`${it.line}-${i}`}>{t("nara.issue", { line: it.line, type: it.type, reason: reason(it) })}</li>
        ))}
        {total > list.length && <li>{t("nara.more", { count: total - list.length })}</li>}
      </ul>
    </details>
  );
}
