import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { api } from "../../api";
import { useSession } from "../../core/session";
import { timerNameToType } from "../../core/activities";
import { toUTC, isNapSleep } from "../simple/time";
import { KINDS } from "./kinds";
import { nudged } from "./story";
import {
  EMPTY_OVERLAY, withAdded, withoutAdded, withRemoved, withoutRemoved, withPatched, withoutPatched, applyOverlay, pruneOverlay,
} from "./overlay";

// How long a just-logged row keeps its "undo / adjust" strip open.
const FRESH_MS = 12000;
const ERROR_MS = 6000;

// The lists the Timeline UI reads, as the server last sent them. Timers are
// taken raw (not from useTimers) so they can go through the same overlay as
// everything else.
function serverLists(data, childId) {
  return {
    feedings: data.weeklyFeedings || [],
    sleeps: data.weeklySleep || [],
    // Demo data has today's diapers only.
    changes: data.weeklyChanges?.length ? data.weeklyChanges : data.changes || [],
    tummyTimes: data.weeklyTummyTimes || [],
    pumping: data.weeklyPumping || [],
    milkWaste: data.weeklyMilkWaste || [],
    temperatures: data.temperatures || [],
    medications: data.medications || [],
    notes: data.notes || [],
    weights: data.weights || [],
    heights: data.heights || [],
    headCircumferences: data.headCircumferences || [],
    bmiEntries: data.bmiEntries || [],
    milestones: data.milestones || [],
    timers: (data.timers || []).filter((x) => !childId || x.child === undefined || x.child === childId),
  };
}

const mapValues = (object, fn) => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]));

// useTimelineLog is everything the Timeline UI does to the log — add, move,
// change, delete, and the timers — with the result on screen at once.
//
// A full refresh is some two dozen requests. Rather than wait for it, each
// action shows its result from the server's own reply to that one request
// (see overlay.js) and starts the refresh behind it. `lists` is what to draw.
//
// Nothing here throws: a failed action puts things back, raises `error` for a
// few seconds, and resolves to null.
export function useTimelineLog() {
  const { data } = useSession();
  const childId = data.child?.id;
  const refetch = data.refetch;
  const [overlay, setOverlay] = useState(EMPTY_OVERLAY);
  // The row just logged: { key, undo }. It opens with its strip showing.
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState(false);

  const server = useMemo(
    () => serverLists(data, childId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      childId, data.weeklyFeedings, data.weeklySleep, data.weeklyChanges, data.changes, data.weeklyTummyTimes,
      data.weeklyPumping, data.weeklyMilkWaste, data.temperatures, data.medications, data.notes, data.weights,
      data.heights, data.headCircumferences, data.bmiEntries, data.milestones, data.timers,
    ],
  );

  // Each refresh takes over whatever it now shows for itself.
  useEffect(() => setOverlay((current) => pruneOverlay(server, current)), [server]);

  // Another child is another log.
  const firstChild = useRef(childId);
  useEffect(() => {
    if (firstChild.current === childId) return;
    firstChild.current = childId;
    setOverlay(EMPTY_OVERLAY);
    setFresh(null);
  }, [childId]);

  useEffect(() => {
    if (!fresh) return undefined;
    const id = setTimeout(() => setFresh((current) => (current === fresh ? null : current)), FRESH_MS);
    return () => clearTimeout(id);
  }, [fresh]);

  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(false), ERROR_MS);
    return () => clearTimeout(id);
  }, [error]);

  const lists = useMemo(() => applyOverlay(server, overlay), [server, overlay]);

  const guard = useCallback(async (work) => {
    try {
      return await work();
    } catch (err) {
      console.error("Timeline action failed:", err);
      setError(true);
      return null;
    }
  }, []);

  const removeEntry = useCallback(async (kind, id) => {
    const { list, remove } = KINDS[kind];
    setOverlay((o) => withRemoved(withoutAdded(o, list, id), list, id));
    try {
      await remove(id);
      refetch();
    } catch (err) {
      setOverlay((o) => withoutRemoved(o, list, id));
      refetch();
      throw err;
    }
    return true;
  }, [refetch]);

  const createEntry = useCallback(async (kind, body, undo) => {
    const { list, create } = KINDS[kind];
    const entry = await create({ child: childId, ...body });
    setOverlay((o) => withAdded(o, list, entry));
    setFresh({
      // A sleep is two rows; the one just written is its waking.
      key: kind === "sleep" ? `sleep-${entry.id}-end` : `${kind}-${entry.id}`,
      undo: () => guard(() => (undo ? undo(entry) : removeEntry(kind, entry.id))),
    });
    refetch();
    return entry;
  }, [childId, refetch, guard, removeEntry]);

  // Shows `shown` on the entry at once and sends the change behind it.
  const changeEntry = useCallback(async (list, entry, shown, send) => {
    setOverlay((o) => withPatched(o, list, { ...entry, ...shown }));
    try {
      await send();
      refetch();
    } catch (err) {
      setOverlay((o) => withoutPatched(o, list, entry.id));
      refetch();
      throw err;
    }
    return true;
  }, [refetch]);

  const add = useCallback((kind, body) => guard(() => createEntry(kind, body)), [guard, createEntry]);

  const remove = useCallback((kind, id) => {
    setFresh(null);
    return guard(() => removeEntry(kind, id));
  }, [guard, removeEntry]);

  // Moves a row a few minutes earlier (negative) or later.
  const nudge = useCallback((row, minutes) => guard(async () => {
    const next = nudged(row, minutes, Date.now());
    if (!next) return null;
    // Moving the row you just logged is a reason to keep its strip open.
    setFresh((current) => (current?.key === row.key ? { ...current } : current));
    const shown = mapValues(next, (ms) => new Date(ms).toISOString());
    const body = mapValues(next, (ms) => toUTC(new Date(ms)));
    if (row.live) return changeEntry("timers", row.timer, shown, () => api.updateTimer(row.timer.id, body));
    const { list, update } = KINDS[row.kind];
    return changeEntry(list, row.entry, shown, () => update(row.entry.id, body));
  }), [guard, changeEntry]);

  const setAmount = useCallback((row, amount) => guard(() => {
    setFresh((current) => (current?.key === row.key ? { ...current } : current));
    const { list, update } = KINDS[row.kind];
    return changeEntry(list, row.entry, { amount }, () => update(row.entry.id, { amount }));
  }), [guard, changeEntry]);

  const dropTimer = useCallback(async (running) => {
    setOverlay((o) => withRemoved(withoutAdded(o, "timers", running.id), "timers", running.id));
    try {
      await api.deleteTimer(running.id);
      refetch();
    } catch (err) {
      setOverlay((o) => withoutRemoved(o, "timers", running.id));
      refetch();
      throw err;
    }
    return true;
  }, [refetch]);

  const discardTimer = useCallback((running) => {
    setFresh(null);
    return guard(() => dropTimer(running));
  }, [guard, dropTimer]);

  // Starts a timer, now or from an earlier moment ("she fell asleep half an
  // hour ago"): `since` is that moment as a Date.
  const startTimer = useCallback((kind, since = null) => guard(async () => {
    const body = { child: childId, name: kind };
    if (since && since.getTime() < Date.now()) body.start = toUTC(since);
    const created = await api.createTimer(body);
    setOverlay((o) => withAdded(o, "timers", created));
    setFresh({ key: `timer-${created.id}`, undo: () => guard(() => dropTimer(created)) });
    refetch();
    return created;
  }), [childId, refetch, guard, dropTimer]);

  // Finishes a timer as an entry, with no form in between: the server takes
  // the start and the pauses from the timer itself. `feeding` says what kind
  // of feed it was. Undoing it puts the timer back where it started.
  const finishTimer = useCallback((running, { feeding, end = new Date() } = {}) => guard(async () => {
    const kind = timerNameToType(running.name);
    const body = { timer: running.id, end: toUTC(end) };
    if (kind === "sleep") body.nap = isNapSleep(new Date(running.start), end);
    if (kind === "feeding") Object.assign(body, feeding);
    setOverlay((o) => withRemoved(withoutAdded(o, "timers", running.id), "timers", running.id));
    try {
      return await createEntry(kind, body, async (entry) => {
        await removeEntry(kind, entry.id);
        const again = await api.createTimer({ child: childId, name: running.name, start: toUTC(new Date(running.start)) });
        setOverlay((o) => withAdded(o, "timers", again));
        refetch();
      });
    } catch (err) {
      // The timer is still running on the server; show it again.
      setOverlay((o) => withoutRemoved(o, "timers", running.id));
      refetch();
      throw err;
    }
  }), [childId, refetch, guard, createEntry, removeEntry]);

  const setPaused = useCallback((running, paused) => guard(async () => {
    const updated = await (paused ? api.pauseTimer(running.id) : api.resumeTimer(running.id));
    setOverlay((o) => withPatched(o, "timers", updated));
    refetch();
    return updated;
  }), [refetch, guard]);

  const undo = useCallback(() => {
    const action = fresh?.undo;
    setFresh(null);
    return action ? action() : null;
  }, [fresh]);

  const dismissFresh = useCallback(() => setFresh(null), []);

  return {
    lists, fresh, undo, dismissFresh, error,
    add, remove, nudge, setAmount, startTimer, finishTimer, discardTimer, setPaused,
  };
}
