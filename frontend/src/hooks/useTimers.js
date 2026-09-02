import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

// Whole seconds spent in completed pauses (both start and end set).
function completedPauseSeconds(pauses) {
  let total = 0;
  for (const p of pauses || []) {
    if (p.start && p.end) {
      total += Math.floor((new Date(p.end).getTime() - new Date(p.start).getTime()) / 1000);
    }
  }
  return total;
}

// Frozen elapsed for a paused timer: start → the open (last) pause's start,
// minus every completed pause before it. Constant while the timer is paused.
function frozenElapsed(t) {
  const pauses = t.pauses || [];
  const last = pauses[pauses.length - 1];
  if (!last?.start) return 0;
  const untilPause = Math.floor((new Date(last.start).getTime() - t.start.getTime()) / 1000);
  return Math.max(0, untilPause - completedPauseSeconds(pauses));
}

function fromServerTimer(t) {
  return {
    id: t.id,
    name: t.name || "timer",
    start: new Date(t.start),
    childId: t.child,
    pauses: t.pauses || [],
  };
}

export function useTimers(serverTimers, childId) {
  const [activeTimers, setActiveTimers] = useState([]);
  const [pausedTimers, setPausedTimers] = useState([]);
  const [elapsedMap, setElapsedMap] = useState({});
  const tickRef = useRef(null);
  // Timers "stopped" locally but not yet deleted server-side. Stopping only
  // opens the entry form — the server timer is deleted when the form is
  // *saved*. Until then background refreshes keep returning the timer, and
  // without this set the sync below would pop the bar right back onto the
  // screen behind the open form.
  const suppressedRef = useRef(new Set());
  // Snapshot of each suppressed timer taken at stop time, so a cancel can
  // restore the bar even when serverTimers hasn't caught up with a timer
  // that was started and stopped within one poll interval.
  const stashedRef = useRef(new Map());
  // Ids that have appeared in at least one serverTimers snapshot. Suppression
  // cleanup keys off this: "absent from the server" only means "saved and
  // deleted" for a timer the server ever reported — a poll snapshot that
  // predates the timer's creation must not clear its suppression.
  const everSeenRef = useRef(new Set());

  // Sync with server timers on data load — only show timers for selected child
  useEffect(() => {
    const serverIds = new Set((serverTimers || []).map((t) => t.id));
    for (const id of serverIds) everSeenRef.current.add(id);
    // Server no longer knows a suppressed timer it previously reported →
    // the entry was saved and the timer deleted; drop the suppression so
    // the id can't shadow a future timer.
    for (const id of suppressedRef.current) {
      if (everSeenRef.current.has(id) && !serverIds.has(id)) {
        suppressedRef.current.delete(id);
        stashedRef.current.delete(id);
      }
    }
    // Bound everSeen: ids gone from the server and no longer suppressed
    // are settled history.
    for (const id of everSeenRef.current) {
      if (!serverIds.has(id) && !suppressedRef.current.has(id)) {
        everSeenRef.current.delete(id);
      }
    }
    if (serverTimers?.length > 0) {
      const filtered = (childId
        ? serverTimers.filter((t) => t.child === childId)
        : serverTimers
      ).filter((t) => !suppressedRef.current.has(t.id));
      
      setActiveTimers(filtered.filter((t) => !t.is_paused).map(fromServerTimer));
      setPausedTimers(filtered.filter((t) => t.is_paused).map(fromServerTimer));
    } else {
      setActiveTimers([]);
      setPausedTimers([]);
    }
  }, [serverTimers, childId]);

  // Tick elapsed time for active timers. Paused timers are frozen, so their
  // value is computed once here and the interval only runs while something
  // is actually counting.
  useEffect(() => {
    const frozen = {};
    for (const t of pausedTimers) frozen[t.id] = frozenElapsed(t);
    if (activeTimers.length === 0) {
      setElapsedMap(frozen);
      clearInterval(tickRef.current);
      return;
    }
    const pauseTotals = activeTimers.map((t) => [t, completedPauseSeconds(t.pauses)]);
    const tick = () => {
      const now = Date.now();
      const map = { ...frozen };
      for (const [t, pauseTotal] of pauseTotals) {
        map[t.id] = Math.max(0, Math.floor((now - t.start.getTime()) / 1000) - pauseTotal);
      }
      setElapsedMap(map);
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => clearInterval(tickRef.current);
  }, [activeTimers, pausedTimers]);

  const startTimer = useCallback(
    async (name) => {
      if (!childId) return;
      const res = await api.createTimer({ child: childId, name });
      setActiveTimers((prev) => [
        ...prev,
        // childId must be set here too — the multi-child label in the timer
        // bar reads it, and waiting for the next server sync leaves it blank.
        { 
          id: res.id, 
          name: res.name || name, 
          start: new Date(res.start), 
          childId: res.child ?? childId,
          pauses: res.pauses || [],
        },
      ]);
    },
    [childId]
  );

  const stopTimer = useCallback(async (timerId) => {
    const timer = activeTimers.find((t) => t.id === timerId);
    if (timer) {
      suppressedRef.current.add(timerId);
      stashedRef.current.set(timerId, { timer, isPaused: false });
      setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
      return { ...timer };
    }
    
    // Handle paused timers: use the pausedTimers.start directly
    // This is the correct start time because it was set when paused
    const paused = pausedTimers.find((t) => t.id === timerId);
    if (paused) {
      setPausedTimers((prev) =>
        prev.filter((t) => t.id !== timerId)
      );
      suppressedRef.current.add(timerId);
      stashedRef.current.set(timerId, { timer: paused, isPaused: true });
      return { ...paused };
    }
    
    return null;
  }, [activeTimers, pausedTimers]);

  const editTimer = useCallback(async (timerId, newStart) => {
    // Use the server response (which carries a Z/offset suffix) to update
    // the in-memory Date. newStart is a UTC naive string from
    // localInputToUTC — new Date() would parse it as local, silently
    // shifting the timer start by the UTC offset on every edit.
    const updated = await api.updateTimer(timerId, { start: newStart });
    const newDate = new Date(updated.start);
    
    // Update in activeTimers or pausedTimers
    setActiveTimers((prev) =>
      prev.map((t) => (t.id === timerId ? { ...t, start: newDate } : t))
    );
    setPausedTimers((prev) =>
      prev.map((t) =>
        t.id === timerId ? { ...t, start: newDate } : t
      )
    );
  }, []);

  const discardTimer = useCallback(async (timerId) => {
    const timer = activeTimers.find((t) => t.id === timerId);
    const paused = pausedTimers.some((t) => t.id === timerId);
    
    if (!timer && !paused) return;
    
    await api.deleteTimer(timerId);
    
    if (timer) {
      setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
    }
    if (paused) {
      setPausedTimers((prev) =>
        prev.filter((t) => t.id !== timerId)
      );
    }
  }, [activeTimers, pausedTimers]);

  const pauseTimer = useCallback(
    (timerId) => {
      const activeTimer = activeTimers.find((t) => t.id === timerId);
      if (!activeTimer) return Promise.reject(new Error("Timer not found"));
      
      // Optimistic update: remove from active, add to paused with the open
      // pause already appended so the frozen elapsed is right immediately.
      const optimistic = {
        ...activeTimer,
        pauses: [...(activeTimer.pauses || []), { start: new Date().toISOString(), end: null }],
      };
      setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
      setPausedTimers((prev) =>
        prev.some((t) => t.id === timerId) ? prev : [...prev, optimistic]
      );

      // A poll can land mid-request and rebuild both lists from a snapshot
      // taken before (or after) the server committed, so every update below
      // reconciles by id across both lists instead of assuming its own
      // optimistic state is still there.
      return api
        .pauseTimer(timerId)
        .then((paused) => {
          const entry = { ...optimistic, pauses: paused.pauses || [] };
          setActiveTimers((prev) => prev.filter((t) => t.id !== timerId));
          setPausedTimers((prev) =>
            prev.some((t) => t.id === timerId)
              ? prev.map((t) => (t.id === timerId ? { ...t, pauses: entry.pauses } : t))
              : [...prev, entry]
          );
        })
        .catch((err) => {
          // Rollback on error
          console.error("Failed to pause timer:", err);
          setPausedTimers((prev) => prev.filter((t) => t.id !== timerId));
          setActiveTimers((prev) =>
            prev.some((t) => t.id === timerId) ? prev : [...prev, activeTimer]
          );
          throw err;
        });
    },
    [activeTimers]
  );

  const resumePausedTimer = useCallback(
    (timerId) => {
      return api
        .resumeTimer(timerId)
        .then((resumed) => {
          // Remove from paused timers and add to active (by id — see pauseTimer)
          const entry = fromServerTimer(resumed);
          setPausedTimers((prev) => prev.filter((t) => t.id !== timerId));
          setActiveTimers((prev) =>
            prev.some((t) => t.id === timerId)
              ? prev.map((t) => (t.id === timerId ? entry : t))
              : [...prev, entry]
          );
        })
        .catch((err) => {
          console.error("Failed to resume timer:", err);
          throw err;
        });
    },
    []
  );

  // Un-suppress a stopped timer — used when the entry form is cancelled, so
  // the still-running server timer becomes visible again immediately instead
  // of silently on the next poll. Falls back to the stop-time snapshot when
  // serverTimers doesn't have the timer yet (started and stopped within one
  // poll interval).
  const resumeTimer = useCallback((timerId) => {
    if (!suppressedRef.current.has(timerId)) return;
    suppressedRef.current.delete(timerId);
    const stashed = stashedRef.current.get(timerId);
    stashedRef.current.delete(timerId);
    
    // Check if this was a paused timer
    if (stashed?.isPaused) {
      const { timer } = stashed;
      if (!timer || (childId && timer.childId !== childId)) return;
      setPausedTimers((prev) => {
        if (!prev.some((p) => p.id === timerId)) {
          return [...prev, timer];
        }
        return prev;
      });
      return;
    }
    
    // Original logic for active timers
    const s = (serverTimers || []).find((t) => t.id === timerId);
    const restored = s ? fromServerTimer(s) : stashed?.timer || stashed;
    if (!restored || (childId && restored.childId !== childId)) return;
    if (s?.is_paused) {
      // Paused on another device while the form was open.
      setPausedTimers((prev) =>
        prev.some((p) => p.id === timerId) ? prev : [...prev, restored]
      );
      return;
    }
    setActiveTimers((prev) =>
      prev.some((p) => p.id === timerId) ? prev : [...prev, restored]
    );
  }, [serverTimers, childId]);

  return { activeTimers, pausedTimers, elapsedMap, startTimer, stopTimer, resumeTimer, editTimer, discardTimer, pauseTimer, resumePausedTimer };
}
