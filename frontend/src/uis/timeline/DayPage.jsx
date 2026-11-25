import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../core/session";
import { useDayData } from "../../hooks/useDayData";
import { formatHoursMinutes } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { usePreferences } from "../../utils/preferences";
import { toUTC } from "../simple/time";
import { Glyph } from "./icons";
import { sleepBetween } from "./insights";
import { KINDS } from "./kinds";
import Stream from "./Stream";
import { buildDated, buildRows, dayKey, groupDays, markSleep, nudged, startOfDay } from "./story";

const HOUR = 3600000;
const ERROR_MS = 6000;

// The start of the day `days` before the one starting at `start` (negative
// for after), by calendar day.
function daysBefore(start, days) {
  const date = new Date(start);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

// DayPage is any one day, told the way the home screen tells today: the same
// rows, the same rail for sleep, the same strip to move, edit or delete an
// entry. It is where the story goes once it runs out of the week the app
// keeps loaded, so it opens on the day before that week.
export default function DayPage({ firstDay, sees, can, describe, tagMaps, volume, onEdit }) {
  const { t } = useI18n();
  const { data, canRead } = useSession();
  const { isViewEnabled } = usePreferences();
  const todayStart = startOfDay(Date.now());
  const [dayStart, setDayStart] = useState(firstDay);
  const [open, setOpen] = useState(null);
  const [failed, setFailed] = useState(false);

  const date = useMemo(() => new Date(dayStart), [dayStart]);
  const day = useDayData(data.child?.id, date, canRead, { milkStockEnabled: isViewEnabled("milkStock") });
  const refetchDay = day.refetch;
  const refetchAll = data.refetch;

  // What is on screen: the last day that finished loading. Stepping to
  // another day keeps this one in view until the next has arrived, instead
  // of flashing "nothing logged" in between.
  const [shown, setShown] = useState(null);
  const wanted = useRef(dayStart);
  wanted.current = dayStart;
  useEffect(() => {
    if (!day.loading && day.entries) setShown({ dayStart: wanted.current, entries: day.entries });
  }, [day.loading, day.entries]);

  // Whatever changes the log — a form saved here, a feed logged on another
  // phone — refreshes this day along with everything else.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) firstSync.current = false;
    else refetchDay();
  }, [data.lastSync, refetchDay]);

  useEffect(() => {
    if (!failed) return undefined;
    const id = setTimeout(() => setFailed(false), ERROR_MS);
    return () => clearTimeout(id);
  }, [failed]);

  const story = useMemo(() => {
    if (!shown) return null;
    const e = shown.entries;
    const lists = {
      feedings: e.feedings, sleeps: e.sleepEntries, changes: e.changes, tummyTimes: e.tummyTimes, pumping: e.pumping,
      milkWaste: e.milkWaste, temperatures: e.temperatures, medications: e.medications, notes: e.notes, weights: e.weights,
      heights: e.heights, headCircumferences: e.headCircumferences, bmiEntries: e.bmiEntries, milestones: e.milestones,
    };
    for (const [kind, k] of Object.entries(KINDS)) if (!sees(kind)) lists[k.list] = [];
    const from = shown.dayStart;
    const to = daysBefore(from, -1);
    // A night that began the evening before shows its waking; one that ran
    // into the next morning shows its falling asleep. markSleep fills in the
    // rest of the rail either way.
    const rows = markSleep(buildRows(lists, { from }).filter((row) => row.at < to));
    const dated = buildDated(lists, { from }).filter((item) => item.day === dayKey(from));
    const feeds = rows.filter((row) => row.kind === "feeding").length;
    const diapers = rows.filter((row) => row.kind === "diaper").length;
    const slept = sleepBetween(lists.sleeps || [], from, Math.min(to, Date.now()));
    const plural = (key, count) => t(`${key}_${count === 1 ? "one" : "other"}`, { count });
    return {
      days: groupDays(rows, dated, from),
      summary: [
        feeds > 0 && plural("timeline.feeds", feeds),
        slept >= 60000 && t("simple.sleepToday", { value: formatHoursMinutes(slept / HOUR) }),
        diapers > 0 && plural("simple.diapersToday", diapers),
      ].filter(Boolean).join(" · ") || null,
    };
  }, [shown, sees, t]);

  const act = useCallback(async (work) => {
    try {
      await work();
      refetchDay();
      refetchAll();
    } catch (err) {
      console.error("Timeline action failed:", err);
      setFailed(true);
    }
  }, [refetchDay, refetchAll]);

  const none = useCallback(() => {}, []);
  const actions = useMemo(() => ({
    toggle: (key) => setOpen((current) => (current === key ? null : key)),
    nudge: (row, minutes) => act(async () => {
      const next = nudged(row, minutes, Date.now());
      if (!next) return;
      const body = Object.fromEntries(Object.entries(next).map(([field, ms]) => [field, toUTC(new Date(ms))]));
      await KINDS[row.kind].update(row.entry.id, body);
    }),
    edit: onEdit,
    remove: (kind, id) => {
      setOpen(null);
      act(() => KINDS[kind].remove(id));
    },
    // Nothing on a past day is new or still running.
    amount: none, undo: none, finish: none, discard: none, pause: none, elapsed: () => 0,
  }), [act, onEdit, none]);

  const go = (days) => {
    setOpen(null);
    setDayStart((start) => Math.min(todayStart, daysBefore(start, days)));
  };
  const pick = (value) => {
    const [y, m, d] = (value || "").split("-").map(Number);
    const picked = new Date(y, m - 1, d).getTime();
    if (Number.isFinite(picked) && picked <= todayStart) {
      setOpen(null);
      setDayStart(picked);
    }
  };

  return (
    <div className="tl-daypage">
      <div className="tl-daynav">
        <button type="button" className="tl-daynav-step" aria-label={t("general.previous")} onClick={() => go(1)}>
          <Glyph.ChevronLeft />
        </button>
        <input
          type="date"
          className="tl-time-input tl-daynav-date"
          aria-label={t("general.date")}
          value={dayKey(dayStart)}
          max={dayKey(todayStart)}
          onChange={(e) => pick(e.target.value)}
        />
        <button type="button" className="tl-daynav-step" aria-label={t("general.next")} disabled={dayStart >= todayStart} onClick={() => go(-1)}>
          <Glyph.ChevronRight />
        </button>
      </div>

      <div className="tl-daypage-card">
        {story ? (
          <Stream
            days={story.days}
            todayStart={todayStart}
            now={0}
            asleepNow={false}
            describe={describe}
            summaryOf={() => story.summary}
            fresh={null}
            open={open}
            actions={actions}
            canEdit={can}
            tagMaps={tagMaps}
            volume={volume}
            earlier={null}
            follow={false}
            emptyText={t("day.noActivity")}
          />
        ) : (
          <p className="tl-loading">{day.error ? t("general.connectionError") : t("general.loading")}</p>
        )}
      </div>

      {failed && <div className="tl-toast" role="alert">{t("general.saveFailed")}</div>}
    </div>
  );
}
