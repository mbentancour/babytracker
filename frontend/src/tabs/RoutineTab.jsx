import { useMemo } from "react";
import SectionCard from "../components/SectionCard";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import { useI18n } from "../utils/i18n";
import { usePreferences, ROUTINE_PERIODS } from "../utils/preferences";
import { useRoutineData } from "../hooks/useRoutineData";
import { formatTime, parseDuration, getDisplayLocale } from "../utils/formatters";
import { toLocalDateKey } from "../hooks/useDayData";

// An actogram: one column per day, midnight at the top, midnight at the
// bottom, every entry drawn at the time it happened.
//
// This is the only view that shows *when* rather than *how much*. The charts
// elsewhere aggregate by day, so they can tell you the baby slept eleven hours
// but never that bedtime has drifted an hour later across three weeks.
//
// Each day is one continuous track with absolutely positioned marks, rather
// than 24 separate hour cells. Cells meant a nine-hour night rendered as nine
// stitched segments inside a heavy lattice — the seams read as separate naps,
// which is precisely the thing the view exists to disprove.

const DAY_MS = 24 * 60 * 60 * 1000;

const ACTIVITIES = [
  { id: "feeding", color: colors.feeding, labelKey: "action.feeding", icon: <Icons.Bottle />, timed: false },
  { id: "sleep", color: colors.sleep, labelKey: "action.sleep", icon: <Icons.Moon />, timed: true },
  { id: "diaper", color: colors.diaper, labelKey: "action.diaper", icon: <Icons.Droplet />, timed: false },
  { id: "tummy", color: colors.tummy, labelKey: "action.tummy", icon: <Icons.Sun />, timed: true },
  { id: "pumping", color: colors.pumping, labelKey: "action.pumping", icon: <Icons.Bottle />, timed: false },
];

// Hour labels down the side. Every hour was unreadable noise at this density;
// every six gives enough to place a mark by eye.
const AXIS_HOURS = [0, 6, 12, 18];

// The end of a timed entry: its own end_time when it has one, otherwise its
// start plus the server-computed duration, otherwise "still running".
function entryEnd(entry, startMs) {
  if (entry.end) {
    const end = new Date(entry.end).getTime();
    if (Number.isFinite(end) && end > startMs) return end;
  }
  const hours = parseDuration(entry.duration);
  if (hours > 0) return startMs + hours * 3600000;
  return Math.min(Date.now(), startMs + DAY_MS);
}

export default function RoutineTab({ childId, canRead = () => true }) {
  const { t } = useI18n();
  const { prefs, setPref, isFeatureEnabled } = usePreferences();
  const days = prefs.routineDays || 14;
  const { entries, loading, error } = useRoutineData(childId, canRead, days);

  // Empty means "show everything" — the chips narrow the view rather than
  // building it up, so the plot is useful before you touch anything.
  const hidden = prefs.routineHidden || [];
  const available = ACTIVITIES.filter((a) => isFeatureEnabled(a.id) && canRead(a.id));
  const toggle = (id) =>
    setPref("routineHidden", hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);

  const dayList = useMemo(() => {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      out.push(d);
    }
    return out;
  }, [days]);

  // columns[i] = the marks belonging to dayList[i], positioned as percentages
  // down that day's track.
  const columns = useMemo(() => {
    const cols = dayList.map(() => []);
    if (!entries) return cols;

    const indexByDay = new Map(dayList.map((d, i) => [toLocalDateKey(d), i]));
    const startOfDay = dayList.map((d) => d.getTime());

    const place = (activity, list, timeKey) => {
      if (hidden.includes(activity.id) || !available.some((a) => a.id === activity.id)) return;

      list.forEach((entry) => {
        const startMs = new Date(entry[timeKey]).getTime();
        if (!Number.isFinite(startMs)) return;

        if (!activity.timed) {
          const col = indexByDay.get(toLocalDateKey(new Date(startMs)));
          if (col === undefined) return;
          cols[col].push({
            id: `${activity.id}-${entry.id}`,
            color: activity.color,
            top: ((startMs - startOfDay[col]) / DAY_MS) * 100,
            height: null,
            title: `${t(activity.labelKey)} · ${formatTime(startMs)}`,
          });
          return;
        }

        // A session running past midnight is clipped into one piece per day it
        // touches, so it reads as a block reaching the bottom of one column and
        // continuing from the top of the next — which is what actually happened.
        const endMs = entryEnd(entry, startMs);
        for (let col = 0; col < dayList.length; col++) {
          const dayStart = startOfDay[col];
          const dayEnd = dayStart + DAY_MS;
          const from = Math.max(startMs, dayStart);
          const to = Math.min(endMs, dayEnd);
          if (to <= from) continue;
          cols[col].push({
            id: `${activity.id}-${entry.id}-${col}`,
            color: activity.color,
            top: ((from - dayStart) / DAY_MS) * 100,
            // A two-minute nap would otherwise be invisible.
            height: Math.max(((to - from) / DAY_MS) * 100, 0.6),
            title: `${t(activity.labelKey)} · ${formatTime(startMs)}`,
          });
        }
      });
    };

    const byId = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
    place(byId.feeding, entries.feedings, "start");
    place(byId.sleep, entries.sleepEntries, "start");
    place(byId.diaper, entries.changes, "time");
    place(byId.tummy, entries.tummyTimes, "start");
    place(byId.pumping, entries.pumping, "start");

    // Spans first, dots last, so a feed that happened during a nap paints over
    // the sleep block instead of being buried under it. Without this the most
    // interesting marks — the ones inside a long sleep — are the ones you
    // can't see.
    cols.forEach((col) => col.sort((a, b) => (a.height === null) - (b.height === null)));
    return cols;
  }, [entries, dayList, hidden, available, t]);

  const isEmpty = columns.every((col) => col.length === 0);
  // Where "now" falls down today's column, so the last column reads as
  // partially elapsed rather than as a suspiciously quiet day.
  const nowPct = ((Date.now() - dayList[dayList.length - 1].getTime()) / DAY_MS) * 100;

  // At a month the weekday name doesn't fit and stops being the useful label
  // anyway — the date is what you navigate by.
  const dense = days > 14;

  return (
    <div className="fade-in">
      <div className="routine-controls">
        <div className="routine-filters" role="group" aria-label={t("routine.filters")}>
          {available.map((a) => {
            const on = !hidden.includes(a.id);
            return (
              <button
                key={a.id}
                className={`routine-filter${on ? " routine-filter-on" : ""}`}
                style={on ? { "--routine-accent": a.color } : undefined}
                onClick={() => toggle(a.id)}
                aria-pressed={on}
              >
                {a.icon}
                {t(a.labelKey)}
              </button>
            );
          })}
        </div>

        <div className="routine-periods" role="group" aria-label={t("routine.period")}>
          {ROUTINE_PERIODS.map((n) => (
            <button
              key={n}
              className={`routine-period${n === days ? " routine-period-on" : ""}`}
              onClick={() => setPref("routineDays", n)}
              aria-pressed={n === days}
            >
              {t("routine.days", { count: n })}
            </button>
          ))}
        </div>
      </div>

      <SectionCard title={t("nav.routine")} icon={<Icons.Clock />} color={colors.sleep}>
        <div className="routine-subtitle">{t("routine.subtitle")}</div>

        {error ? (
          <div style={{ color: colors.temp, fontSize: 13, textAlign: "center", padding: 30 }}>
            {t("general.connectionError")}
          </div>
        ) : loading && !entries ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 30 }}>
            {t("general.loading")}
          </div>
        ) : (
          <>
            <div className="routine-plot">
              <div className="routine-axis" aria-hidden="true">
                {AXIS_HOURS.map((h) => (
                  <span key={h} style={{ top: `${(h / 24) * 100}%` }}>
                    {String(h).padStart(2, "0")}
                  </span>
                ))}
                <span style={{ top: "100%" }}>24</span>
              </div>

              <div className="routine-scroll">
                <div className={`routine-cols${dense ? " routine-cols-dense" : ""}`}>
                  {dayList.map((d, col) => {
                    const isToday = col === dayList.length - 1;
                    return (
                      <div key={toLocalDateKey(d)} className="routine-col">
                        <div className="routine-track">
                          {columns[col].map((m) => (
                            <span
                              key={m.id}
                              className={m.height === null ? "routine-mark routine-mark-point" : "routine-mark"}
                              style={{
                                background: m.color,
                                top: `${m.top}%`,
                                height: m.height === null ? undefined : `${m.height}%`,
                              }}
                              title={m.title}
                            />
                          ))}
                          {isToday && nowPct > 0 && nowPct < 100 && (
                            <span className="routine-now" style={{ top: `${nowPct}%` }} />
                          )}
                        </div>
                        <div className={`routine-col-head${isToday ? " routine-col-head-today" : ""}`}>
                          {!dense && (
                            <span className="routine-col-day">
                              {d.toLocaleDateString(getDisplayLocale(), { weekday: "short" })}
                            </span>
                          )}
                          <span className="routine-col-date">{d.getDate()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {isEmpty && (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("routine.noActivity")}
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
