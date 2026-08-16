import { useMemo, useState } from "react";
import SectionCard from "../components/SectionCard";
import TimelineItem from "../components/TimelineItem";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import { useUnits } from "../utils/units";
import { useI18n } from "../utils/i18n";
import { usePreferences } from "../utils/preferences";
import { useDayData, toLocalDateKey } from "../hooks/useDayData";
import { formatTime, formatDuration, parseDuration, formatHoursMinutes, feedingMethodLabel, getDisplayLocale } from "../utils/formatters";

// One day, every activity type, in the order it happened. The Overview tab
// answers "how is today going"; the Journal tab covers notes, milestones and
// medications. Neither gives a straight chronological account of a single day,
// and nothing at all lets you look at a day that isn't today.

// Each row's colour and label. `feature` is the RBAC/preference key that gates
// the type; `milkWaste` borrows pumping's, as it does everywhere else.
const ROW_TYPES = {
  feeding: { color: colors.feeding, labelKey: "action.feeding", feature: "feeding" },
  sleep: { color: colors.sleep, labelKey: "action.sleep", feature: "sleep" },
  diaper: { color: colors.diaper, labelKey: "action.diaper", feature: "diaper" },
  tummy: { color: colors.tummy, labelKey: "action.tummy", feature: "tummy" },
  pumping: { color: colors.pumping, labelKey: "action.pumping", feature: "pumping" },
  milkWaste: { color: colors.milkWaste, labelKey: "action.milkWaste", feature: "pumping" },
  temp: { color: colors.temp, labelKey: "action.temp", feature: "temp" },
  weight: { color: colors.growth, labelKey: "action.weight", feature: "weight" },
  height: { color: colors.height, labelKey: "action.height", feature: "height" },
  headcirc: { color: colors.growth, labelKey: "action.headCirc", feature: "headcirc" },
  bmi: { color: colors.feeding, labelKey: "action.bmi", feature: "bmi" },
  medication: { color: "#e67e22", labelKey: "action.medication", feature: "medication" },
  milestone: { color: "#00b894", labelKey: "action.milestone", feature: "milestone" },
  note: { color: colors.note, labelKey: "action.note", feature: "note" },
};

const dayBounds = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
};

export default function DayTab({ childId, onEditEntry, canRead = () => true, canWrite = () => true }) {
  const units = useUnits();
  const { t } = useI18n();
  const { isFeatureEnabled, isViewEnabled } = usePreferences();
  const [day, setDay] = useState(() => new Date());

  const { entries, loading, error } = useDayData(childId, day, canRead, {
    milkStockEnabled: isViewEnabled("milkStock"),
  });

  const todayKey = toLocalDateKey(new Date());
  const dayKey = toLocalDateKey(day);
  const isToday = dayKey === todayKey;

  const shiftDay = (delta) => {
    setDay((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const rows = useMemo(() => {
    if (!entries) return [];
    const [dayStart, dayEnd] = dayBounds(day);

    // A sleep or tummy-time session that began the previous evening belongs on
    // this day too, positioned at midnight rather than at its real start —
    // otherwise the night's longest sleep is missing from the morning.
    const spanning = (list, type, label) =>
      list
        .filter((e) => {
          const start = new Date(e.start).getTime();
          const end = e.end ? new Date(e.end).getTime() : Date.now();
          return start < dayEnd && end >= dayStart;
        })
        .map((e) => {
          const start = new Date(e.start).getTime();
          return {
            type,
            at: Math.max(start, dayStart),
            continued: start < dayStart,
            label: label(e),
            entry: e,
          };
        });

    const point = (list, type, timeKey, label) =>
      list.map((e) => ({ type, at: new Date(e[timeKey]).getTime(), label: label(e), entry: e }));

    // Measurements and milestones carry a date but no time. They're pinned to
    // midday so they sort into the middle of the day instead of always leading
    // it, which would read as "this happened before breakfast".
    const midday = new Date(dayStart);
    midday.setHours(12, 0, 0, 0);
    const dated = (list, type, label) =>
      list.map((e) => ({ type, at: midday.getTime(), timeless: true, label: label(e), entry: e }));

    const diaperLabel = (c) =>
      c.wet && c.solid ? t("diaper.both") : c.solid ? t("diaper.solid") : t("diaper.wet");

    const all = [
      ...point(entries.feedings, "feeding", "start", (f) => {
        const parts = [];
        if (f.amount) parts.push(`${f.amount} ${units.volume}`);
        if (f.method) parts.push(feedingMethodLabel(f.method, t));
        const hours = parseDuration(f.duration);
        if (hours > 0 && f.method !== "bottle") parts.push(formatHoursMinutes(hours));
        return parts.join(" · ") || t("action.feeding");
      }),
      ...spanning(entries.sleepEntries, "sleep", (s) =>
        [formatDuration(s.duration), s.nap ? t("sleep.nap") : t("sleep.night")].filter(Boolean).join(" · "),
      ),
      ...point(entries.changes, "diaper", "time", diaperLabel),
      ...spanning(entries.tummyTimes, "tummy", (tt) => formatDuration(tt.duration)),
      ...point(entries.pumping, "pumping", "start", (p) =>
        p.amount ? `${p.amount} ${units.volume}` : formatDuration(p.duration),
      ),
      ...point(entries.milkWaste, "milkWaste", "time", (m) => `${m.amount} ${units.volume}`),
      ...point(entries.temperatures, "temp", "time", (e) => `${e.temperature} ${units.temp}`),
      ...point(entries.medications, "medication", "time", (m) =>
        [m.name, m.dosage && `${m.dosage} ${m.dosage_unit}`].filter(Boolean).join(" · "),
      ),
      ...point(entries.notes, "note", "time", (n) => n.note),
      ...dated(entries.weights, "weight", (e) => `${e.weight} ${units.weight}`),
      ...dated(entries.heights, "height", (e) => `${e.height} ${units.length}`),
      ...dated(entries.headCircumferences, "headcirc", (e) => `${e.head_circumference} ${units.length}`),
      ...dated(entries.bmiEntries, "bmi", (e) => String(e.bmi)),
      ...dated(entries.milestones, "milestone", (m) => m.title),
    ];

    return all
      .filter((row) => {
        const meta = ROW_TYPES[row.type];
        if (!isFeatureEnabled(meta.feature)) return false;
        if (row.type === "milkWaste" && !isViewEnabled("milkStock")) return false;
        return true;
      })
      .sort((a, b) => a.at - b.at);
  }, [entries, day, t, units, isFeatureEnabled, isViewEnabled]);

  return (
    <div className="fade-in">
      <div className="day-nav">
        <button
          className="day-nav-btn"
          onClick={() => shiftDay(-1)}
          aria-label={t("general.previous")}
        >
          ‹
        </button>
        <input
          type="date"
          className="day-nav-date"
          value={dayKey}
          max={todayKey}
          onChange={(e) => e.target.value && setDay(new Date(`${e.target.value}T12:00:00`))}
          aria-label={t("nav.day")}
        />
        <button
          className="day-nav-btn"
          onClick={() => shiftDay(1)}
          disabled={isToday}
          aria-label={t("general.next")}
        >
          ›
        </button>
        <button className="day-nav-today" onClick={() => setDay(new Date())} disabled={isToday}>
          {t("day.today")}
        </button>
      </div>

      <SectionCard
        title={day.toLocaleDateString(getDisplayLocale(), { weekday: "long", day: "numeric", month: "long" })}
        icon={<Icons.Clock />}
        color={colors.diaper}
      >
        {error ? (
          <div style={{ color: colors.temp, fontSize: 13, textAlign: "center", padding: 30 }}>
            {t("general.connectionError")}
          </div>
        ) : loading && !entries ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 30 }}>
            {t("general.loading")}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 30 }}>
            {t("day.noActivity")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((row, i) => {
              const meta = ROW_TYPES[row.type];
              const editable = canWrite(meta.feature) && !!row.entry?.id;
              return (
                <div
                  key={`${row.type}-${row.entry?.id ?? i}`}
                  className={editable ? "entry-clickable" : undefined}
                  onClick={editable ? () => onEditEntry?.(row.type, row.entry) : undefined}
                >
                  <TimelineItem
                    // A timeless measurement showing "12:00" would be a lie, and
                    // a session carried over from last night didn't start now.
                    time={row.timeless ? "—" : row.continued ? `↑ ${formatTime(row.at)}` : formatTime(row.at)}
                    label={t(meta.labelKey)}
                    detail={row.label}
                    color={meta.color}
                    isLast={i === rows.length - 1}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
