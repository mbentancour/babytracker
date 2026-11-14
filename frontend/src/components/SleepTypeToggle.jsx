import { useI18n } from "../utils/i18n";

export default function SleepTypeToggle({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    ["total", t("growth.sleepTotal")],
    ["nap", t("sleep.nap")],
    ["night", t("sleep.night")],
  ];

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }} role="group" aria-label={t("growth.sleepFilterLabel")}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: value === key ? "#6C5CE7" : "var(--card-bg)",
            color: value === key ? "white" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}