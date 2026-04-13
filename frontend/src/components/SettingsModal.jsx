import { useState } from "react";
import { api } from "../api";
import Modal, { FormField, FormSelect } from "./Modal";
import { Icons } from "./Icons";
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

const SECTIONS = ["general", "features", "defaults", "data"];

export default function SettingsModal({ childId, unitSystem, onClose, onLogout, onRefetch }) {
  const [section, setSection] = useState("general");
  const [units, setUnits] = useState(unitSystem || "metric");
  const [exporting, setExporting] = useState(false);
  const { prefs, setFeatureEnabled, setFormDefault, setPref } = usePreferences();

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
    <Modal title="Settings" onClose={onClose}>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: section === s ? "var(--border)" : "none",
              color: section === s ? "var(--text)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* General */}
      {section === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "-8px 0 16px" }}>
            After no interaction, the app shows a slideshow of your baby's photos. Tap anywhere to return.
          </p>

          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                border: "1px solid #e74c3c30",
                background: "none",
                color: "#e74c3c",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <Icons.Logout />
              Sign Out
            </button>
          )}
        </div>
      )}

      {/* Feature Toggles */}
      {section === "features" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 12px" }}>
            Disable features you don't need. They'll be hidden from the menus and dashboard.
          </p>
          {FEATURE_LIST.map((f) => (
            <label
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: prefs.features[f.id] ? "transparent" : "var(--bg)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: prefs.features[f.id] ? "var(--text)" : "var(--text-dim)" }}>
                  {f.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{f.description}</div>
              </div>
              <input
                type="checkbox"
                checked={prefs.features[f.id] !== false}
                onChange={(e) => setFeatureEnabled(f.id, e.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#6C5CE7" }}
              />
            </label>
          ))}
        </div>
      )}

      {/* Form Defaults */}
      {section === "defaults" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
            Set default values for new entries. These will be pre-selected when you open a form.
          </p>

          <div style={{ background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
              Feeding Defaults
            </div>
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

          <div style={{ background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
              Medication Defaults
            </div>
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

          <div style={{ background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Auto-calculate BMI</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  Fill BMI from weight and height when no doctor-provided value exists for that date. Manual entries always take priority.
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.autoCalculateBMI !== false}
                onChange={(e) => setPref("autoCalculateBMI", e.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#6C5CE7", flexShrink: 0, marginLeft: 12 }}
              />
            </label>
          </div>
        </div>
      )}

      {/* Data Export */}
      {section === "data" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            className="export-btn"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center", padding: "12px" }}
            onClick={() => handleExport("all")}
            disabled={exporting || !childId}
          >
            <Icons.Download />
            {exporting ? "Exporting..." : "Export All Data (CSV)"}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {["feedings", "sleep", "changes", "weight", "height", "head_circumference", "temperature", "medications", "milestones"].map((type) => (
              <button
                key={type}
                className="export-btn"
                style={{ fontSize: 11, padding: "8px" }}
                onClick={() => handleExport(type)}
                disabled={exporting || !childId}
              >
                {type.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
