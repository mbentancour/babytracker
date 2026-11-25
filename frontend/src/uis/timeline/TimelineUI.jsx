import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import AppModals, { useAppModal } from "../../components/AppModals";
import { timerNameToType } from "../../core/activities";
import { useSession } from "../../core/session";
import { elapsedSince, formatHoursMinutes, formatTime, getDisplayLocale } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { agoAnchor, formatAwake } from "../../utils/overlayTime";
import { usePreferences } from "../../utils/preferences";
import { useUnits } from "../../utils/units";
import Composer from "./Composer";
import DayPage from "./DayPage";
import { Glyph } from "./icons";
import { byNow, countBetween, feedRhythm, lastWoke, nextSleepAt, sleepBetween } from "./insights";
import { KINDS } from "./kinds";
import Overview from "./Overview";
import Sky, { SkyPaint } from "./Sky";
import { skyAt, span } from "./daylight";
import Stream from "./Stream";
import { buildDated, buildRows, describeRow, groupDays, markSleep, nextMinuteIn, startOfDay, time, timerElapsed } from "./story";
import { useTimelineLog } from "./useTimelineLog";
import "./timeline.css";

const GrowthTab = lazy(() => import("../../tabs/GrowthTab"));
const NotesTab = lazy(() => import("../../tabs/NotesTab"));
const RoutineTab = lazy(() => import("../../tabs/RoutineTab"));
const GalleryTab = lazy(() => import("../../tabs/GalleryTab"));

const HOUR = 3600000;
// The app keeps a week of entries loaded; the story starts with two days of
// it and can be rolled back to all seven.
const FIRST_DAYS = 2;
const LOADED_DAYS = 7;

// Amounts step in the device's own unit, and start from these when nothing
// has been logged to go by.
const VOLUME = {
  mL: { step: 10, feeding: 120, pumping: 90 },
  oz: { step: 0.5, feeding: 4, pumping: 3 },
};

const PAGES = {
  overview: { titleKey: "nav.overview" },
  growth: { titleKey: "nav.growth", icon: Glyph.Trend, features: ["weight", "height", "headcirc", "bmi"] },
  routine: { titleKey: "nav.routine", icon: Glyph.Timer, features: ["feeding", "sleep", "diaper", "tummy", "pumping"], view: "routine" },
  journal: { titleKey: "nav.journal", icon: Glyph.Book, features: ["note", "milestone", "medication"] },
  photos: { titleKey: "nav.photos", icon: Glyph.Photo, features: ["photo"] },
  day: { titleKey: "timeline.olderDays", icon: Glyph.Calendar, features: ["feeding", "sleep", "diaper", "tummy", "pumping", "temp", "medication", "note"] },
};

// The start of the day `days` before the one starting at `start` (negative
// for after). Stepped by calendar day so a clock change can't shift it.
function daysBefore(start, days) {
  const date = new Date(start);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

function newest(entries) {
  let best = null;
  let bestAt = -Infinity;
  for (const entry of entries) {
    const at = time(agoAnchor(entry));
    if (at !== null && at > bestAt) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

// The clock, read again every `every` ms and also as each minute begins. On
// the minute, because the screen is told in minutes: read only now and then,
// "Now" would still say 04:29 for a while under an entry logged at 04:30.
function useNow(every) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      id = setTimeout(tick, Math.min(every, nextMinuteIn(at)));
    };
    tick();
    return () => clearTimeout(id);
  }, [every]);
  return now;
}


// The Timeline UI: the day told as a story you add to. A strip of sky across
// the top shows the last 24 hours and how things stand; below it the entries
// run oldest to newest and end at "now", right above the buttons that write
// the next line. Everything it shows and saves goes through useSession().
export default function TimelineUI() {
  const { t } = useI18n();
  const units = useUnits();
  const { isFeatureEnabled, isViewEnabled } = usePreferences();
  const { data, canRead, canWrite, deleteEntry } = useSession();
  const { modal, setModal, closeModal, handleFormDone } = useAppModal();
  const log = useTimelineLog();

  const [shown, setShown] = useState(FIRST_DAYS);
  const [open, setOpen] = useState(null); // the row whose strip is open
  const [tray, setTray] = useState(null); // the composer tray that is open
  // The pages opened on top of the story, innermost last: on a phone Growth
  // is reached through Overview, and Back should return there.
  const [pages, setPages] = useState([]);
  const page = pages[pages.length - 1] || null;
  const openPage = useCallback((id) => setPages((open) => [...open, id]), []);
  const closePage = useCallback(() => setPages((open) => open.slice(0, -1)), []);
  // Going from one page straight to another keeps Back pointing where it did.
  const switchPage = useCallback((id) => setPages((open) => [...open.slice(0, -1), id]), []);

  const sees = useCallback((kind) => {
    const k = KINDS[kind];
    return isFeatureEnabled(k.feature) && canRead(k.feature) && (!k.view || isViewEnabled(k.view));
  }, [isFeatureEnabled, isViewEnabled, canRead]);
  const can = useCallback((kind) => sees(kind) && canWrite(KINDS[kind].feature), [sees, canWrite]);

  // What this user may see, with what they just did already in place.
  const lists = useMemo(() => {
    const out = { ...log.lists };
    for (const [kind, k] of Object.entries(KINDS)) if (!sees(kind)) out[k.list] = [];
    return out;
  }, [log.lists, sees]);

  const timers = useMemo(
    () => (lists.timers || []).map((x) => ({ ...x, kind: timerNameToType(x.name) })).filter((x) => sees(x.kind)),
    [lists.timers, sees],
  );
  const running = useMemo(() => ({
    sleep: timers.find((x) => x.kind === "sleep"),
    feeding: timers.find((x) => x.kind === "feeding"),
    tummy: timers.find((x) => x.kind === "tummy"),
  }), [timers]);

  // A running timer counts in seconds; otherwise the screen only has to keep
  // "2h 10m ago" honest.
  const now = useNow(timers.length ? 1000 : 15000);
  const minute = Math.floor(now / 60000) * 60000;
  const todayStart = startOfDay(now);

  const days = useMemo(() => {
    const from = daysBefore(todayStart, shown - 1);
    const rows = markSleep(buildRows(lists, { from, timers }));
    return groupDays(rows, buildDated(lists, { from }), todayStart);
  }, [lists, timers, shown, todayStart]);

  // Sleep, counting the one going on now.
  const sleeps = useMemo(
    () => (running.sleep ? [...lists.sleeps, { id: "now", start: running.sleep.start, end: null }] : lists.sleeps),
    [lists.sleeps, running.sleep],
  );

  const words = useMemo(() => {
    const cache = new WeakMap();
    return (row) => {
      if (!cache.has(row)) cache.set(row, describeRow(row, { t, units }));
      return cache.get(row);
    };
  }, [t, units]);

  const plural = useCallback((key, count) => t(`${key}_${count === 1 ? "one" : "other"}`, { count }), [t]);
  const length = (ms) => formatHoursMinutes(ms / HOUR);

  // "5 feeds · 9h 20m sleep · 4 diapers" under each day's name.
  const summaries = useMemo(() => {
    const out = new Map();
    for (const day of days) {
      const feeds = day.rows.filter((r) => r.kind === "feeding" && !r.live).length;
      const diapers = day.rows.filter((r) => r.kind === "diaper").length;
      const slept = sees("sleep") ? sleepBetween(sleeps, day.start, Math.min(daysBefore(day.start, -1), minute)) : 0;
      const parts = [
        feeds > 0 && plural("timeline.feeds", feeds),
        slept >= 60000 && t("simple.sleepToday", { value: length(slept) }),
        diapers > 0 && plural("simple.diapersToday", diapers),
      ].filter(Boolean);
      out.set(day.key, parts.join(" · ") || null);
    }
    return out;
  }, [days, sleeps, minute, sees, plural, t]);

  // How things stand right now, for the top of the screen.
  const kpis = useMemo(() => {
    const out = [];
    const ago = (stamp) => {
      const value = elapsedSince(stamp);
      return value === null ? t("time.justNow") : t("time.ago", { value });
    };
    const since = (stamp) => t("timeline.since", { time: formatTime(stamp) });
    if (sees("sleep")) {
      const woke = lastWoke(lists.sleeps);
      if (running.sleep) {
        out.push({ key: "sleep", label: t("timeline.asleep"), value: formatAwake(timerElapsed(running.sleep, minute + 59999) * 1000), sub: since(running.sleep.start) });
      } else if (woke !== null && minute - woke < 20 * HOUR) {
        const next = nextSleepAt(lists.sleeps);
        const sub = next === null ? since(woke) : next <= minute ? t("timeline.sleepDue") : t("timeline.sleepAround", { time: formatTime(next) });
        out.push({ key: "sleep", label: t("timeline.awake"), value: formatAwake(Math.max(0, minute + 59999 - woke)), sub });
      } else {
        out.push({ key: "sleep", label: t("action.sleep"), value: "—" });
      }
    }
    if (sees("feeding")) {
      const last = newest(lists.feedings);
      if (running.feeding) {
        out.push({ key: "feeding", label: t("timer.feeding"), value: formatAwake(timerElapsed(running.feeding, minute + 59999) * 1000), sub: since(running.feeding.start) });
      } else if (last) {
        const at = time(agoAnchor(last));
        const next = feedRhythm(lists.feedings)?.nextAt ?? null;
        const sub = next === null || minute - at > 12 * HOUR
          ? words({ kind: "feeding", entry: last }).title
          : next <= minute ? t("timeline.feedDue") : t("timeline.feedAround", { time: formatTime(next) });
        out.push({ key: "feeding", label: t("timeline.lastFeed"), value: ago(agoAnchor(last)), sub });
      } else {
        out.push({ key: "feeding", label: t("timeline.lastFeed"), value: "—" });
      }
    }
    if (sees("diaper")) {
      const last = newest(lists.changes);
      out.push(last
        ? { key: "diaper", label: t("timeline.lastDiaper"), value: ago(last.time), sub: t(last.wet && last.solid ? "diaper.both" : last.solid ? "diaper.solid" : "diaper.wet") }
        : { key: "diaper", label: t("timeline.lastDiaper"), value: "—" });
    }
    return out;
  }, [lists, running, minute, sees, words, t]);

  // Today so far against the same stretch of the days before.
  const today = useMemo(() => {
    const out = [];
    const compare = (kind, measure, tracked, say, sayUsual) => {
      const { today: value, usual } = byNow(measure, (from, to) => tracked(from, to) > 0, minute);
      const top = Math.max(value, usual || 0) * 1.12 || 1;
      out.push({
        kind,
        value: say(value),
        usual: usual === null ? null : t("timeline.usually", { value: sayUsual(usual) }),
        fill: Math.min(1, value / top),
        mark: usual === null ? null : usual / top,
      });
    };
    if (sees("feeding")) {
      const count = countBetween(lists.feedings, "start");
      compare("feeding", count, count, (n) => plural("timeline.feeds", n), (n) => Math.round(n));
    }
    if (sees("sleep")) {
      const slept = (from, to) => sleepBetween(sleeps, from, to);
      compare("sleep", slept, slept, (ms) => t("simple.sleepToday", { value: ms >= 60000 ? length(ms) : "0m" }), (ms) => (ms >= 60000 ? length(ms) : "0m"));
    }
    if (sees("diaper")) {
      const count = countBetween(lists.changes, "time");
      compare("diaper", count, count, (n) => plural("simple.diapersToday", n), (n) => Math.round(n));
    }
    return out;
  }, [lists, sleeps, minute, sees, plural, t]);

  // Each of the last seven days as a strip from midnight to midnight.
  const week = useMemo(() => {
    if (!sees("sleep")) return null;
    const rows = [];
    for (let back = LOADED_DAYS - 1; back >= 0; back--) {
      const start = daysBefore(todayStart, back);
      const end = daysBefore(todayStart, back - 1);
      const spans = [];
      for (const s of sleeps) {
        const from = time(s.start);
        const at = from === null ? null : span(from, time(s.end) ?? minute, start, end);
        if (at) spans.push(at);
      }
      const total = sleepBetween(sleeps, start, Math.min(end, minute));
      rows.push({
        key: start,
        today: back === 0,
        label: new Date(start).toLocaleDateString(getDisplayLocale(), { weekday: "short" }),
        spans,
        total: total >= 60000 ? length(total) : "—",
      });
    }
    return rows;
  }, [sleeps, todayStart, minute, sees]);

  const pageOpen = (id) => {
    const p = PAGES[id];
    return (!p.view || isViewEnabled(p.view)) && (!p.features || p.features.some((f) => canRead(f)));
  };
  const links = ["growth", "routine", "journal", "photos", "day"]
    .filter(pageOpen)
    .map((id) => ({ id, label: t(PAGES[id].titleKey), icon: PAGES[id].icon }));

  // "Older days" is reached from the top of the story, not from the header.
  const navLinks = links.filter((link) => link.id !== "day");

  const editEntry = useCallback((kind, entry) => setModal({ type: kind, entry }), [setModal]);

  const actions = useMemo(() => ({
    toggle: (key) => {
      log.dismissFresh();
      setOpen((current) => (current === key ? null : key));
    },
    nudge: log.nudge,
    amount: log.setAmount,
    undo: log.undo,
    edit: editEntry,
    remove: (kind, id) => {
      setOpen(null);
      log.remove(kind, id);
    },
    // A feed can be given several ways, so finishing one asks which; a sleep
    // or tummy time just ends.
    finish: (timer) => (timer.kind === "feeding" ? setTray("feeding") : log.finishTimer(timer)),
    discard: (timer) => {
      setOpen(null);
      log.discardTimer(timer);
    },
    pause: log.setPaused,
    elapsed: timerElapsed,
  }), [log.dismissFresh, log.nudge, log.setAmount, log.undo, log.remove, log.finishTimer, log.discardTimer, log.setPaused, editEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new line in the story closes whatever was open further up.
  const freshKey = log.fresh?.key || null;
  useEffect(() => {
    if (freshKey) setOpen(null);
  }, [freshKey]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || modal) return;
      if (tray) setTray(null);
      else if (page) closePage();
      else setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tray, page, modal, closePage]);

  const volume = useMemo(() => ({ unit: units.volume, ...(VOLUME[units.volume] || VOLUME.mL) }), [units.volume]);
  const summaryOf = useCallback((day) => summaries.get(day.key), [summaries]);

  const earlier = shown < LOADED_DAYS
    ? { label: t("timeline.earlierDays"), onClick: () => setShown((n) => Math.min(LOADED_DAYS, n + 2)) }
    : pageOpen("day") ? { older: true, label: t("timeline.olderDays"), onClick: () => openPage("day") } : null;

  // The sky's colours right now, for the parts drawn by plain CSS (see
  // .settings-header in the stylesheet).
  const skyVars = useMemo(() => {
    const here = skyAt(minute);
    return { "--tl-sky-high": here.high, "--tl-sky-horizon": here.horizon };
  }, [minute]);

  const openForm = (type, extra) => {
    setTray(null);
    setModal({ type, ...extra });
  };
  const editOrNot = (type, entry) => canWrite(KINDS[type]?.feature || type) && setModal({ type, entry });
  const deleteOrNot = (type, id) => canWrite(KINDS[type]?.feature || type) && deleteEntry(type, id);

  return (
    <div className="tl" style={skyVars}>
      <div className="tl-frame">
        <Sky
          now={now}
          sleeps={lists.sleeps}
          feedings={lists.feedings}
          asleepSince={running.sleep ? time(running.sleep.start) : null}
          kpis={kpis}
          child={data.child}
          kids={data.children}
          links={navLinks}
          onPage={openPage}
          onSelectChild={data.selectChild}
          onEditChild={() => data.child && setModal({ type: "editChild", child: data.child })}
          onSettings={() => setModal({ type: "settings" })}
          onOverview={() => openPage("overview")}
          error={data.error}
        />

        <div className="tl-body">
          <main className="tl-main">
            <Stream
              days={days}
              todayStart={todayStart}
              now={now}
              asleepNow={!!running.sleep}
              describe={words}
              summaryOf={summaryOf}
              fresh={freshKey}
              open={open}
              actions={actions}
              canEdit={can}
              tagMaps={data.tagMaps}
              volume={volume}
              earlier={earlier}
            />
            <Composer
              log={log}
              feedings={lists.feedings}
              pumping={lists.pumping}
              timers={running}
              can={can}
              now={now}
              units={units}
              volume={volume}
              tray={tray}
              setTray={setTray}
              onForm={openForm}
            />
          </main>
          <aside className="tl-side"><Overview today={today} week={week} links={[]} onPage={openPage} /></aside>
        </div>
      </div>

      {log.error && <div className="tl-toast" role="alert">{t("general.saveFailed")}</div>}

      {page && (
        <div className="tl-page" role="dialog" aria-label={t(PAGES[page].titleKey)}>
          <div className="tl-frame">
            {/* The same sky as the home screen, so a page is plainly part of
                the same place; on a wide screen the other pages are one click
                away from here too. */}
            <header className="tl-sky tl-page-sky">
              <SkyPaint at={minute} />
              <button type="button" className="tl-page-back" onClick={closePage}>
                <Glyph.ChevronLeft />
                {t("simple.back")}
              </button>
              <h1>{t(PAGES[page].titleKey)}</h1>
              {navLinks.length > 0 && (
                <nav className="tl-nav" aria-label={t("timeline.lookBack")}>
                  {navLinks.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className="tl-nav-btn"
                      title={link.label}
                      aria-current={page === link.id ? "page" : undefined}
                      onClick={() => switchPage(link.id)}
                    >
                      <link.icon />
                      <span>{link.label}</span>
                    </button>
                  ))}
                </nav>
              )}
            </header>
            <div className="tl-page-body">
            <Suspense fallback={<p className="tl-loading">{t("general.loading")}</p>}>
              {page === "overview" && <Overview today={today} week={week} links={links} onPage={openPage} />}
              {page === "growth" && (
                <GrowthTab
                  weights={data.weights}
                  heights={data.heights}
                  headCircumferences={data.headCircumferences}
                  bmiEntries={data.bmiEntries}
                  monthlyFeedings={data.monthlyFeedings}
                  monthlySleep={data.monthlySleep}
                  monthlyPumping={data.monthlyPumping}
                  child={data.child}
                  tagMaps={data.tagMaps}
                  onEditEntry={editOrNot}
                  onDeleteEntry={deleteOrNot}
                  canWrite={canWrite}
                />
              )}
              {page === "routine" && <RoutineTab childId={data.child?.id} canRead={canRead} />}
              {page === "journal" && (
                <NotesTab
                  notes={data.notes}
                  milestones={data.milestones}
                  medications={data.medications}
                  tagMaps={data.tagMaps}
                  onEditEntry={editOrNot}
                  onDeleteEntry={deleteOrNot}
                  canWrite={canWrite}
                />
              )}
              {page === "photos" && <GalleryTab childId={data.child?.id} children={data.children} canWrite={canWrite("photo")} />}
              {page === "day" && (
                <DayPage
                  firstDay={daysBefore(todayStart, LOADED_DAYS)}
                  sees={sees}
                  can={can}
                  describe={words}
                  tagMaps={data.tagMaps}
                  volume={volume}
                  onEdit={editEntry}
                />
              )}
            </Suspense>
            </div>
          </div>
        </div>
      )}

      <AppModals modal={modal} setModal={setModal} closeModal={closeModal} handleFormDone={handleFormDone} />
    </div>
  );
}
