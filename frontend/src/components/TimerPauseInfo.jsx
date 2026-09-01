import { useI18n } from "../utils/i18n";
import { formatElapsed } from "../utils/formatters";

export default function TimerPauseInfo({ timer }) {
  const { t } = useI18n();

  if (!timer || !timer.pauses || timer.pauses.length === 0) {
    return null;
  }

  // Filter only completed pauses (those with both start and end times)
  const completedPauses = timer.pauses.filter((p) => p.start && p.end);
  if (completedPauses.length === 0) {
    return null;
  }

  // Calculate total pause duration
  let totalPauseDuration = 0;
  completedPauses.forEach((pause) => {
    const pauseStart = new Date(pause.start).getTime();
    const pauseEnd = new Date(pause.end).getTime();
    totalPauseDuration += Math.floor((pauseEnd - pauseStart) / 1000);
  });

  // Calculate actual duration (without pauses)
  const startTime = new Date(timer.start).getTime();
  const endTime = new Date(timer.end || new Date()).getTime();
  const totalDuration = Math.floor((endTime - startTime) / 1000);
  const actualDuration = Math.max(0, totalDuration - totalPauseDuration);

  // Format pause times as "HH:MM-HH:MM"
  const formatTime = (date) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const pauseList = completedPauses
    .map((p) => `${formatTime(p.start)}-${formatTime(p.end)}`)
    .join(", ");

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
        <strong>{t("timer.actualDuration")}:</strong> {formatElapsed(actualDuration)}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        <strong>{t("timer.pauses")}:</strong> {pauseList}
      </div>
    </div>
  );
}
