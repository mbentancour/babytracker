import { useI18n } from "../utils/i18n";
import { formatDuration, formatHoursMinutes } from "../utils/formatters";
import { FormInput } from "./Modal";

export default function EntryTiming({ entry, pausedMinutes, onPausedMinutesChange }) {
  const { t } = useI18n();
  if (!entry) return null;

  const pausedSeconds = Math.max(0, Number(entry.paused_seconds) || 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        marginBottom: 14,
      }}
    >
      <div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          {t("general.duration")}
        </div>
        <div
          role="status"
          aria-label={t("general.duration")}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 14,
            fontFamily: "inherit",
            userSelect: "none",
            WebkitUserSelect: "none",
            cursor: "not-allowed",
          }}
        >
          {formatDuration(entry.duration)}
        </div>
      </div>
      <div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          {t(onPausedMinutesChange ? "general.pausedMinutes" : "general.paused")}
        </div>
        {onPausedMinutesChange ? (
          <FormInput
            type="number"
            min="0"
            step="1"
            value={pausedMinutes}
            onChange={(event) => onPausedMinutesChange(event.target.value)}
          />
        ) : (
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>
            {pausedSeconds === 0 ? "0m" : formatHoursMinutes(pausedSeconds / 3600)}
          </div>
        )}
      </div>
    </div>
  );
}
