import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

export function useTimers(serverTimers, childId) {
  const [activeTimers, setActiveTimers] = useState([]);
  const [elapsedMap, setElapsedMap] = useState({});
  const tickRef = useRef(null);

  // Sync with server timers on data load — only show timers for selected child
  useEffect(() => {
    if (serverTimers?.length > 0) {
      const filtered = childId
        ? serverTimers.filter((t) => t.child === childId)
        : serverTimers;
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
        { id: res.id, name: res.name || name, start: new Date(res.start) },
      ]);
    },
    [childId]
  );

  const stopTimer = useCallback(async (timerId) => {
    const timer = activeTimers.find((t) => t.id === timerId);
    if (!timer) return null;
    setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
    return { ...timer };
  }, [activeTimers]);

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

  return { activeTimers, elapsedMap, startTimer, stopTimer, editTimer, discardTimer };
}
