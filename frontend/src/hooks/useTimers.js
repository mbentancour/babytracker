import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

export function useTimers(serverTimers, childId) {
  const [activeTimers, setActiveTimers] = useState([]);
  const [elapsedMap, setElapsedMap] = useState({});
  const tickRef = useRef(null);
  // Timers "stopped" locally but not yet deleted server-side. Stopping only
  // opens the entry form — the server timer is deleted when the form is
  // *saved*. Until then background refreshes keep returning the timer, and
  // without this set the sync below would pop the bar right back onto the
  // screen behind the open form.
  const suppressedRef = useRef(new Set());

  // Sync with server timers on data load — only show timers for selected child
  useEffect(() => {
    // Server no longer knows a suppressed timer → the entry was saved and
    // the timer deleted; drop the suppression so the id can't shadow a
    // future timer.
    const serverIds = new Set((serverTimers || []).map((t) => t.id));
    for (const id of suppressedRef.current) {
      if (!serverIds.has(id)) suppressedRef.current.delete(id);
    }
    if (serverTimers?.length > 0) {
      const filtered = (childId
        ? serverTimers.filter((t) => t.child === childId)
        : serverTimers
      ).filter((t) => !suppressedRef.current.has(t.id));
      setActiveTimers(
        filtered.map((t) => ({
          id: t.id,
          name: t.name || "timer",
          start: new Date(t.start),
          childId: t.child,
        }))
      );
    } else {
      setActiveTimers([]);
    }
  }, [serverTimers, childId]);

  // Tick elapsed time for all active timers
  useEffect(() => {
    if (activeTimers.length === 0) {
      setElapsedMap({});
      clearInterval(tickRef.current);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const map = {};
      for (const t of activeTimers) {
        map[t.id] = Math.floor((now - t.start.getTime()) / 1000);
      }
      setElapsedMap(map);
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => clearInterval(tickRef.current);
  }, [activeTimers]);

  const startTimer = useCallback(
    async (name) => {
      if (!childId) return;
      const res = await api.createTimer({ child: childId, name });
      setActiveTimers((prev) => [
        ...prev,
        // childId must be set here too — the multi-child label in the timer
        // bar reads it, and waiting for the next server sync leaves it blank.
        { id: res.id, name: res.name || name, start: new Date(res.start), childId: res.child ?? childId },
      ]);
    },
    [childId]
  );

  const stopTimer = useCallback(async (timerId) => {
    const timer = activeTimers.find((t) => t.id === timerId);
    if (!timer) return null;
    suppressedRef.current.add(timerId);
    setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
    return { ...timer };
  }, [activeTimers]);

  // Un-suppress a stopped timer — used when the entry form is cancelled, so
  // the still-running server timer becomes visible again immediately instead
  // of silently on the next poll.
  const resumeTimer = useCallback((timerId) => {
    if (!suppressedRef.current.has(timerId)) return;
    suppressedRef.current.delete(timerId);
    const t = (serverTimers || []).find((s) => s.id === timerId);
    if (!t || (childId && t.child !== childId)) return;
    setActiveTimers((prev) =>
      prev.some((p) => p.id === timerId)
        ? prev
        : [...prev, { id: t.id, name: t.name || "timer", start: new Date(t.start), childId: t.child }]
    );
  }, [serverTimers, childId]);

  const editTimer = useCallback(async (timerId, newStart) => {
    // Use the server response (which carries a Z/offset suffix) to update
    // the in-memory Date. newStart is a UTC naive string from
    // localInputToUTC — new Date() would parse it as local, silently
    // shifting the timer start by the UTC offset on every edit.
    const updated = await api.updateTimer(timerId, { start: newStart });
    setActiveTimers((prev) =>
      prev.map((t) => (t.id === timerId ? { ...t, start: new Date(updated.start) } : t))
    );
  }, []);

  const discardTimer = useCallback(async (timerId) => {
    const timer = activeTimers.find((t) => t.id === timerId);
    if (!timer) return;
    await api.deleteTimer(timerId);
    setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
  }, [activeTimers]);

  return { activeTimers, elapsedMap, startTimer, stopTimer, resumeTimer, editTimer, discardTimer };
}
