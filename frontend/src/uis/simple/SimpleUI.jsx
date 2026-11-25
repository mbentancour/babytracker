import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { api } from "../../api";
import { useSession } from "../../core/session";
import { ACTION_GROUPS, entryFeature, timerNameToType } from "../../core/activities";
import AppModals, { useAppModal } from "../../components/AppModals";
import { Icons } from "../../components/Icons";
import { agoAnchor } from "../../utils/overlayTime";
import { getAge, elapsedSince, formatElapsed, formatHoursMinutes, feedingMethodLabel, overlapHours } from "../../utils/formatters";
import { usePreferences } from "../../utils/preferences";
import { useI18n } from "../../utils/i18n";
import { useUnits } from "../../utils/units";
import QuickLog, { defaultFeeding } from "./QuickLog";
import { toUTC, isNapSleep } from "./time";
import "./simple.css";
const DayTab = lazy(() => import("../../tabs/DayTab"));

// The simple UI shows the everyday activities only; measurements, notes and
// the rest stay in the full UI (and in the full forms behind "More options").
const KINDS = ["feeding", "sleep", "diaper", "tummy", "pumping"];
const ACTIVITIES = ACTION_GROUPS.flatMap((g) => g.actions).filter((a) => KINDS.includes(a.id));

const TOAST_MS = 6000;

function latest(entries = []) {
  let best = null;
  let bestAt = -Infinity;
  for (const entry of entries) {
    const at = new Date(agoAnchor(entry)).getTime();
    if (Number.isFinite(at) && at > bestAt) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

function spanLabel(entry) {
  const hours = (new Date(entry.end) - new Date(entry.start)) / 3600000;
  return hours > 0 ? formatHoursMinutes(hours) : null;
}

// The simple UI: when each thing last happened, and one tap to log the next.
// Everything it shows and saves goes through useSession(), like the full UI.
export default function SimpleUI() {
  const { t } = useI18n();
  const units = useUnits();
  const { isFeatureEnabled, getFormDefault } = usePreferences();
  const { data, timer, canRead, canWrite, deleteEntry } = useSession();
  const { modal, setModal, closeModal, handleFormDone } = useAppModal();
  const [view, setView] = useState("home"); // "home" | "history"
  const [sheet, setSheet] = useState(null); // an activity id, or null
  const [toast, setToast] = useState(null); // { text, undo? }
  const toastTimer = useRef(null);

  // "45m ago" goes stale on a screen left open; redraw it twice a minute.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = (next) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const childId = data.child?.id;
  const timers = [...timer.activeTimers, ...timer.pausedTimers].filter((x) => !x.childId || x.childId === childId);
  const runningFor = (kind) => timers.find((x) => timerNameToType(x.name) === kind);

  const saved = (kind, id) => {
    setSheet(null);
    data.refetch();
    showToast({ text: t("simple.saved"), undo: id ? () => deleteEntry(kind, id) : undefined });
  };

  // Stops a timer and saves its entry in one go, with no form in between: the
  // server takes the start and any pauses from the timer itself.
  const finishTimer = async (running) => {
    const kind = timerNameToType(running.name);
    const stopped = await timer.stopTimer(running.id);
    if (!stopped) return;
    const now = new Date();
    const body = { child: childId, timer: stopped.id, end: toUTC(now) };
    try {
      let result;
      if (kind === "sleep") {
        result = await api.createSleep({ ...body, nap: isNapSleep(new Date(stopped.start), now) });
      } else if (kind === "tummy") {
        result = await api.createTummyTime(body);
      } else {
        const { type, method } = defaultFeeding(getFormDefault);
        result = await api.createFeeding({ ...body, type, method });
      }
      saved(kind, result?.id);
    } catch (err) {
      // The timer is still running on the server; put its row back.
      timer.resumeTimer(stopped.id);
      throw err;
    }
  };

  const finishFromRow = (running) =>
    finishTimer(running).catch(() => showToast({ text: t("simple.saveFailed") }));

  const sources = {
    feeding: data.weeklyFeedings,
    sleep: data.weeklySleep,
    diaper: data.weeklyChanges?.length ? data.weeklyChanges : data.changes,
    tummy: data.weeklyTummyTimes,
    pumping: data.weeklyPumping,
  };

  const ago = (dateStr) => {
    const value = elapsedSince(dateStr);
    return value === null ? t("time.justNow") : t("time.ago", { value });
  };

  const detail = (kind, entry) => {
    if (kind === "feeding") {
      const how = feedingMethodLabel(entry.method, t);
      return Number(entry.amount) > 0 ? `${Number(entry.amount)} ${units.volume} · ${how}` : how;
    }
    if (kind === "diaper") {
      return t(entry.wet && entry.solid ? "diaper.both" : entry.solid ? "diaper.solid" : "diaper.wet");
    }
    if (kind === "pumping") return Number(entry.amount) > 0 ? `${Number(entry.amount)} ${units.volume}` : null;
    return spanLabel(entry);
  };

  // The line under an activity's name: what is happening now, or when it last
  // happened and what it was.
  const status = (kind, running) => {
    if (running) {
      const elapsed = formatElapsed(timer.elapsedMap[running.id] || 0);
      return t(kind === "sleep" ? "simple.asleepFor" : "simple.inProgress", { value: elapsed });
    }
    const entry = latest(sources[kind]);
    if (!entry) return t("simple.nothingYet");
    const at = agoAnchor(entry);
    if (kind === "sleep") {
      const awake = elapsedSince(at);
      return awake === null ? t("simple.justWoke") : t("simple.awakeFor", { value: awake });
    }
    const extra = detail(kind, entry);
    return extra ? `${ago(at)} · ${extra}` : ago(at);
  };

  const visible = ACTIVITIES.filter((a) => isFeatureEnabled(a.id) && canRead(a.id));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sleepHours = (data.weeklySleep || []).reduce(
    (sum, s) => sum + overlapHours(s, startOfToday.getTime(), Date.now()),
    0
  );
  const today = [
    canRead("feeding") && isFeatureEnabled("feeding") &&
      t(data.feedings.length === 1 ? "overview.feedingsToday_one" : "overview.feedingsToday_other", { count: data.feedings.length }),
    canRead("sleep") && isFeatureEnabled("sleep") &&
      t("simple.sleepToday", { value: sleepHours > 0 ? formatHoursMinutes(sleepHours) : "0m" }),
    canRead("diaper") && isFeatureEnabled("diaper") &&
      t(data.changes.length === 1 ? "simple.diapersToday_one" : "simple.diapersToday_other", { count: data.changes.length }),
  ].filter(Boolean);

  const openEditChild = () => data.child && setModal({ type: "editChild", child: data.child });
  const editEntry = (type, entry) => canWrite(entryFeature(type)) && setModal({ type, entry });

  return (
    <div className="simple">
      <header className="simple-header">
        <div
          role="button"
          tabIndex={0}
          aria-label={t("general.tapToEdit")}
          title={t("general.tapToEdit")}
          onClick={openEditChild}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openEditChild();
            }
          }}
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: 0 }}
        >
          <span className="avatar">
            {data.child?.picture ? (
              <img src={data.child.picture} alt="" className="avatar-img" />
            ) : (
              <Icons.Baby />
            )}
          </span>
          <span style={{ minWidth: 0 }}>
            <h1 className="baby-name">{data.child?.first_name || t("general.baby")}</h1>
            {data.child?.birth_date && <span className="baby-age">{getAge(data.child.birth_date, t)}</span>}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data.error && <span className="sync-error">{t("general.connectionError")}</span>}
          <button className="refresh-btn" onClick={() => setModal({ type: "settings" })} title={t("settings.title")} aria-label={t("settings.title")}>
            <Icons.Settings />
          </button>
        </div>
      </header>

      {data.children.length > 1 && (
        <div className="child-switcher">
          {data.children.map((c) => (
            <button
              key={c.id}
              className={`child-chip${c.id === data.child?.id ? " child-chip-active" : ""}`}
              onClick={() => data.selectChild(c.id)}
            >
              {c.first_name}
            </button>
          ))}
        </div>
      )}

      {view === "history" ? (
        <>
          <button type="button" className="simple-plain" style={{ marginBottom: 12 }} onClick={() => setView("home")}>
            ← {t("simple.back")}
          </button>
          <Suspense fallback={<p className="simple-row-sub" style={{ textAlign: "center", padding: 40 }}>{t("general.loading")}</p>}>
            <DayTab childId={childId} canRead={canRead} canWrite={canWrite} onEditEntry={editEntry} />
          </Suspense>
        </>
      ) : (
        <>
          <div className="simple-list">
            {visible.map((a) => {
              const running = runningFor(a.id);
              const writable = canWrite(a.id);
              return (
                <div key={a.id} className="simple-row">
                  <button
                    type="button"
                    className="simple-row-main"
                    disabled={!writable}
                    onClick={() => setSheet(a.id)}
                  >
                    <span className="simple-row-icon" style={{ background: `${a.color}18`, color: a.color }} aria-hidden="true">
                      {a.icon}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <div className="simple-row-title">{t(a.labelKey)}</div>
                      <div className="simple-row-sub">{status(a.id, running)}</div>
                    </span>
                  </button>
                  {writable && (running ? (
                    <button
                      type="button"
                      className="simple-row-add"
                      style={{ background: a.color, color: "#fff" }}
                      onClick={() => finishFromRow(running)}
                    >
                      {t(a.id === "sleep" ? "simple.wakeUp" : "simple.finish")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="simple-row-add"
                      style={{ background: `${a.color}18`, color: a.color, fontSize: 22 }}
                      aria-label={t("simple.logAria", { what: t(a.labelKey) })}
                      onClick={() => setSheet(a.id)}
                    >
                      +
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {today.length > 0 && (
            <div className="simple-today">
              <div className="simple-label">{t("day.today")}</div>
              <div style={{ fontSize: 15, color: "var(--text)" }}>{today.join(" · ")}</div>
            </div>
          )}

          <button type="button" className="simple-plain" style={{ marginTop: 12 }} onClick={() => setView("history")}>
            {t("simple.history")} →
          </button>
        </>
      )}

      {sheet && (
        <QuickLog
          kind={sheet}
          running={runningFor(sheet)}
          elapsed={runningFor(sheet) ? timer.elapsedMap[runningFor(sheet).id] : 0}
          onClose={() => setSheet(null)}
          onSaved={saved}
          onStarted={() => { setSheet(null); showToast({ text: t("simple.timerStarted") }); }}
          onFinish={finishTimer}
          onMore={() => { const kind = sheet; setSheet(null); setModal({ type: kind }); }}
        />
      )}

      {toast && (
        <div className="simple-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo;
                clearTimeout(toastTimer.current);
                setToast(null);
                undo();
              }}
            >
              {t("simple.undo")}
            </button>
          )}
        </div>
      )}

      <AppModals modal={modal} setModal={setModal} closeModal={closeModal} handleFormDone={handleFormDone} />
    </div>
  );
}
