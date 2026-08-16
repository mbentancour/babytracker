import Modal from "./Modal";
import TimelineItem from "./TimelineItem";
import DiaperBadge from "./DiaperBadge";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import {
  toFeedingTimeline,
  toSleepBlocks,
  toDiaperTimeline,
  toPumpingTimeline,
  getDisplayLocale,
  parseDuration,
} from "../utils/formatters";
import { useUnits } from "../utils/units";
import { useI18n } from "../utils/i18n";

export default function DayActivitiesModal({ day, type, data, onEditEntry, onClose }) {
  const units = useUnits();
  const { t } = useI18n();

  const getIcon = () => {
    switch (type) {
      case "feeding": return <Icons.Bottle />;
      case "sleep": return <Icons.Moon />;
      case "tummy": return <Icons.Sun />;
      case "pumping": return <Icons.Bottle />;
      default: return <Icons.Activity />;
    }
  };

  const getColor = () => {
    switch (type) {
      case "feeding": return colors.feeding;
      case "sleep": return colors.sleep;
      case "tummy": return colors.tummy;
      case "pumping": return colors.pumping;
      default: return colors.diaper;
    }
  };

  const getTitle = () => {
    const key = {
      feeding: "dayModal.feedings",
      sleep: "dayModal.sleepSessions",
      tummy: "dayModal.tummySessions",
      pumping: "dayModal.pumpingSessions",
    }[type] || "dayModal.activities";
    return `${t(key)} - ${day}`;
  };

  const renderContent = () => {
    if (!data || data.length === 0) {
      return (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
          {t("dayModal.noActivities")}
        </div>
      );
    }

    if (type === "feeding") {
      const timeline = toFeedingTimeline(data, units.volume, t);
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {timeline.map((f, i, arr) => (
            <div
              key={i}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("feeding", f.entry);
                onClose();
              }}
            >
              <TimelineItem
                time={f.time}
                label={f.label}
                detail={f.detail}
                color={colors.feeding}
                isLast={i === arr.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    if (type === "sleep") {
      const blocks = toSleepBlocks(data);
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {blocks.map((s, i, arr) => (
            <div
              key={i}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("sleep", s.entry);
                onClose();
              }}
            >
              <TimelineItem
                time={`${s.start}–${s.end}`}
                label={`${s.duration.toFixed(1)}h${s.nap ? ` · ${t("sleep.nap")}` : ""}`}
                detail={t("general.timeRange", { from: s.start, to: s.end })}
                color={colors.sleep}
                isLast={i === arr.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    if (type === "pumping") {
      const timeline = toPumpingTimeline(data, units.volume, t);
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {timeline.map((p, i, arr) => (
            <div
              key={i}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("pumping", p.entry);
                onClose();
              }}
            >
              <TimelineItem
                time={p.time}
                label={p.label}
                detail={p.detail}
                color={colors.pumping}
                isLast={i === arr.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    if (type === "tummy") {
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {data.map((tt, i, arr) => (
            <div
              key={i}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("tummy", tt);
                onClose();
              }}
            >
              <TimelineItem
                time={new Date(tt.start).toLocaleTimeString(getDisplayLocale(), { hour: "2-digit", minute: "2-digit" })}
                label={`${Math.round(parseDuration(tt.duration) * 60)} min${tt.milestone ? ` · ${tt.milestone}` : ""}`}
                detail={t("general.timeRange", { from: new Date(tt.start).toLocaleTimeString(getDisplayLocale(), { hour: "2-digit", minute: "2-digit" }), to: new Date(tt.end).toLocaleTimeString(getDisplayLocale(), { hour: "2-digit", minute: "2-digit" }) })}
                color={colors.tummy}
                isLast={i === arr.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  return (
    <Modal title={getTitle()} onClose={onClose}>
      <div style={{ padding: "0 4px" }}>
        {renderContent()}
      </div>
    </Modal>
  );
}
