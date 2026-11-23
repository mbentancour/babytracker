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

// What differs between the apps an export can come from. The api calls are
// looked up when used, not here, so tests can replace them.
const SOURCES = {
  nara: {
    preview: (file, units) => api.previewNaraImport(file, units),
    run: (file, fields) => api.importFromNara(file, fields),
    title: "onboarding.importNara",
    hint: "onboarding.naraHint",
    chooseFile: "nara.chooseFile",
    sleepNote: "nara.sleepClassified",
    // text/* as well: Android WebView hosts (e.g. the Home Assistant app)
    // grey out .csv files whose type is text/comma-separated-values.
    accept: ".csv,text/csv,text/*",
    multiple: false,
    accent: ACCENT,
    button: ACCENT_BUTTON,
  },
  // Baby Tracker by Nighp Software: a zip of CSVs, or the CSVs themselves.
  nighp: {
    preview: (files, units) => api.previewNighpImport(files, units),
    run: (files, fields) => api.importFromNighp(files, fields),
    title: "onboarding.importNighp",
    hint: "onboarding.nighpHint",
    chooseFile: "nighp.chooseFile",
    sleepNote: "nighp.sleepClassified",
    accept: ".zip,application/zip,.csv,text/csv,text/*",
    multiple: true,
    accent: "#0984e3",
    button: "#0866b3",
  },
};

// DataImport walks an admin through importing another app's export: pick
// the file, see what's in it (the baby's details are prefilled from the
// export's profile row), then import into a new child and review what came
// across.
//
// unitSystem is the device's unit setting. Stored amounts carry no unit and
// each device labels them with its own setting, so amounts are saved in
// unitSystem. Only on first run, with no other babies yet, can the user pick
// other units: pass onUnitsChange, which gets the choice after the import so
// this device then shows the units the amounts were saved in. onBusy(true) is
// called while the new child exists but the summary hasn't been dismissed, so
// a background refresh doesn't swap the screen out from under it. doneLabel
// names the summary's button. source picks the app the export comes from
// ("nara", the default, or "nighp"); the steps and the summary are the same.
export default function DataImport({ source = "nara", unitSystem, onUnitsChange, onDone, onBack, onBusy, doneLabel }) {
  const { t } = useI18n();
  const src = SOURCES[source] || SOURCES.nara;
  const ids = useId();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [units, setUnits] = useState(unitSystem === "imperial" ? "imperial" : "metric");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState("");
  // The duplicate-pumping box as the user set it; null until they touch it.
  const [includeChoice, setIncludeChoice] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const previewSeq = useRef(0);
  const resultHeading = useRef(null);
  // What the last export's profile filled in, so a newly picked export can
  // replace it without overwriting anything the user typed.
  const prefilled = useRef({ name: "", birth_date: "", sex: "" });

  // Release the hold if this goes away mid-import (it shouldn't: Back is
  // disabled while importing).
  useEffect(() => () => onBusy?.(false), [onBusy]);

  // The form, and the button that had focus, are gone once the import is
  // done: move focus to the result's heading, which also announces it.
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const errorText = (err) => {
    // The server's own 413 names its limit. One from a proxy in front of it
    // (an HTML page, no code) has some lower limit we can't know.
    if (err?.status === 413) {
      return err.code === "too_large" && err.detail
        ? t("import.error.too_large", { detail: err.detail })
        : t("import.error.too_large_proxy");
    }
    if (err?.status === 401) return t("import.error.session_expired");
    if (err?.code) {
      const key = `import.error.${err.code}`;
      const text = t(key, { detail: err.detail || "" });
      if (text !== key) return text;
    }
    // A failed fetch (offline, dropped connection) or a timeout; anything
    // else without a code (a proxy's error page, a rate limit) gets the
    // generic text.
    if (err instanceof TypeError || /timed out/i.test(err?.message || "")) return t("import.error.network");
    return t("import.error.generic");
  };

  const runPreview = async (picked, system) => {
    const seq = ++previewSeq.current;
    setPreview(null);
    setError("");
    setChecking(true);
    try {
      const res = await src.preview(picked, system);
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
    const all = Array.from(e.target.files || []);
    const picked = src.multiple ? (all.length ? all : null) : all[0] || null;
    e.target.value = ""; // let the same file be picked again after a fix
    if (!picked) return;
    setFile(picked);
    setIncludeChoice(null);
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
      const res = await src.run(file, { firstName, lastName, birthDate, sex, unitSystem: units, includeDuplicates });
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
          <h1 className="login-title" ref={resultHeading} tabIndex={-1} style={{ outline: "none" }}>{t("onboarding.importComplete")}</h1>
        </div>
        <Summary data={result} done sleepNote={src.sleepNote} />
        <button onClick={finish} className="login-button" style={{ background: colors.feeding, width: "100%" }}>
          {doneLabel || t("onboarding.continueToDashboard")}
        </button>
      </Card>
    );
  }

  const duplicates = preview?.duplicate_pumping?.count || 0;
  // Family pumping already saved for a baby with the name being imported is
  // most likely this same baby imported again (say after a trial import
  // that will be deleted), so the box starts ticked; otherwise unticked.
  const sameBaby = (preview?.duplicate_pumping?.children || []).some(
    (name) => sameName(name, firstName) || sameName(name, preview?.profile?.name),
  );
  const includeDuplicates = duplicates > 0 && (includeChoice ?? sameBaby);
  const importable = total(preview?.stats) + (includeDuplicates ? duplicates : 0);
  const nothingToImport = preview && importable === 0 && duplicates === 0;

  return (
    <Card>
      <div className="login-header">
        <div className="login-icon" style={{ background: `${src.accent}18`, color: src.accent }}><Icons.Download /></div>
        <h1 className="login-title">{t(src.title)}</h1>
        <p className="login-subtitle">{t(src.hint)}</p>
      </div>
      <form onSubmit={handleImport} className="login-form">
        {error && <div className="login-error" role="alert">{error}</div>}
        <label className="file-picker" style={{ color: importing ? "var(--text-dim)" : "var(--text-muted)", cursor: importing ? "not-allowed" : "pointer" }}>
          <span style={{ flexShrink: 0, display: "flex" }}><Icons.Download /></span>
          <span>
            {t(src.chooseFile)}
            {file && <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>{[].concat(file).map((f) => f.name).join(", ")}</span>}
          </span>
          <input
            type="file"
            className="visually-hidden"
            accept={src.accept}
            multiple={src.multiple}
            onChange={handleFile}
            // Not disabled while the preview runs, so focus stays here; a
            // newer pick simply replaces the older one.
            disabled={importing}
          />
        </label>

        {onUnitsChange && (
          <div className="login-field">
            <label className="login-label" htmlFor={`${ids}-units`}>{t("import.saveUnits")}</label>
            <select id={`${ids}-units`} className="login-input" value={units} onChange={handleUnits} disabled={importing}>
              <option value="metric">{t("settings.metric")}</option>
              <option value="imperial">{t("settings.imperial")}</option>
            </select>
          </div>
        )}

        <div role="status" aria-live="polite">
          {checking && <p className="login-label" style={{ margin: 0 }}>{t("import.checking")}</p>}
          {preview && (
            <div>
              <div className="login-label" style={{ marginBottom: 6 }}>{t("import.found")}</div>
              {nothingToImport && (
                <div className="login-error" style={{ textAlign: "left", marginBottom: 8 }}>{t("import.error.nothing_to_import")}</div>
              )}
              <Summary data={preview} includeDuplicates={includeDuplicates} sleepNote={src.sleepNote} />
            </div>
          )}
        </div>

        {duplicates > 0 && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--text-muted)" }}>
            <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeChoice(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{t("import.importDuplicates", { count: duplicates })}</span>
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
          <button type="submit" className="login-button" style={{ background: src.button }} disabled={!preview || checking || importing || importable === 0}>
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

function sameName(a, b) {
  return !!a && !!b && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

// joinNames lists names the way the language does ("Ana, Bo and Cy").
function joinNames(names, locale) {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  } catch {
    return names.join(", "); // browsers without Intl.ListFormat
  }
}

// Summary lists what an export holds (preview) or what was imported (result,
// done): counts per entry type, the units amounts were saved in, what was
// saved as notes or not imported, and rows imported with an assumption or
// not read. includeDuplicates is the preview's duplicate-pumping choice; a
// result says itself whether those sessions were imported.
function Summary({ data, done, includeDuplicates, sleepNote = "nara.sleepClassified" }) {
  const { t, locale } = useI18n();
  const counts = STAT_LABELS.filter(([k]) => data.stats?.[k] > 0);
  const skipped = Object.entries(data.skipped || {});
  const asNotes = Object.entries(data.as_notes || {});
  const u = data.units || {};
  const list = (entries) => entries.map(([type, n]) => `${type} (${n})`).join(", ");
  const dup = data.duplicate_pumping;
  const dupKey = done
    ? (dup?.included ? "import.duplicatePumpingImported" : "import.duplicatePumpingSkipped")
    : (includeDuplicates ? "import.duplicatePumpingWillImport" : "import.duplicatePumpingWillSkip");
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
        {counts.length > 0 && u.volume && <p style={{ margin: 0 }}>{t("import.unitsUsed", u)}</p>}
        {data.stats?.sleep > 0 && <p style={{ margin: 0 }}>{t(sleepNote)}</p>}
        {data.date_order_assumed && counts.length > 0 && <p style={{ margin: 0 }}>{t("nighp.dateOrderAssumed")}</p>}
        {data.solid_feeds > 0 && <p style={{ margin: 0 }}>{t("nara.solidsParentFed")}</p>}
        {asNotes.length > 0 && <p style={{ margin: 0 }}>{t("import.asNotes")} {list(asNotes)}</p>}
        {dup?.count > 0 && (
          <p style={{ margin: 0 }}>
            {t(dupKey, { count: dup.count, children: joinNames(dup.children || [], locale) })}
          </p>
        )}
        {skipped.length > 0 && <p style={{ margin: 0 }}>{t("import.skipped")} {list(skipped)}</p>}
        <Issues title={t("import.warnings", { count: data.warning_count })} items={data.warnings} total={data.warning_count} />
        <Issues title={t("import.rejected", { count: data.rejected_count })} items={data.rejected} total={data.rejected_count} />
      </div>
    </div>
  );
}

function Issues({ title, items, total }) {
  const { t } = useI18n();
  if (!total) return null;
  const list = items || [];
  const more = total - list.length;
  const reason = (it) => {
    const key = `import.reason.${it.code}`;
    const text = t(key, { detail: it.detail || "", value: it.value || "" });
    return text !== key ? text : it.reason;
  };
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>{title}</summary>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto" }}>
        {list.map((it, i) => (
          <li key={`${it.line}-${i}`}>{t("import.issue", { line: it.line, type: it.type, reason: reason(it) })}</li>
        ))}
        {more > 0 && <li>{t(more === 1 ? "import.more_one" : "import.more_other", { count: more })}</li>}
      </ul>
    </details>
  );
}
