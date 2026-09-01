import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

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
      
      const active = filtered.filter((t) => !t.isPaused);
      const paused = filtered.filter((t) => t.isPaused);
      
      setActiveTimers(
        active.map((t) => ({
          id: t.id,
          name: t.name || "timer",
          start: new Date(t.start),
          childId: t.child,
          pauses: t.pauses || [],
        }))
      );
      setPausedTimers(
        paused.map((t) => ({
          id: t.id,
          name: t.name || "timer",
          start: new Date(t.start),
          childId: t.child,
          pausedElapsed: t.pausedElapsed || 0,
          pauses: t.pauses || [],
        }))
      );
    } else {
      setActiveTimers([]);
      setPausedTimers([]);
    }
  }, [serverTimers, childId]);

  // Tick elapsed time for all active timers (paused timers show frozen elapsed time from server)
  useEffect(() => {
    if (activeTimers.length === 0 && pausedTimers.length === 0) {
      setElapsedMap({});
      clearInterval(tickRef.current);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const map = {};
      // Active timers: calculate elapsed from start time, minus pause durations
      for (const t of activeTimers) {
        let elapsed = Math.floor((now - t.start.getTime()) / 1000);
        // Subtract pause durations
        if (t.pauses && t.pauses.length > 0) {
          for (const pause of t.pauses) {
            if (pause.start && pause.end) {
              const pauseDuration = Math.floor((new Date(pause.end).getTime() - new Date(pause.start).getTime()) / 1000);
              elapsed -= pauseDuration;
            }
          }
        }
        map[t.id] = Math.max(0, elapsed);
      }
      // Paused timers: frozen elapsed time — calculate from start to when the pause began
      for (const t of pausedTimers) {
        let elapsed = 0;
        if (t.pauses && t.pauses.length > 0) {
          // Find when the current pause started (last pause entry)
          const lastPause = t.pauses[t.pauses.length - 1];
          if (lastPause.start) {
            // Elapsed = time from start to pause start, minus all completed pause durations
            elapsed = Math.floor((new Date(lastPause.start).getTime() - t.start.getTime()) / 1000);
            // Subtract durations of all *completed* pauses (those with end time)
            for (let i = 0; i < t.pauses.length - 1; i++) {
              const pause = t.pauses[i];
              if (pause.start && pause.end) {
                const pauseDuration = Math.floor((new Date(pause.end).getTime() - new Date(pause.start).getTime()) / 1000);
                elapsed -= pauseDuration;
              }
            }
          }
        }
        map[t.id] = Math.max(0, elapsed);
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
      
      // Optimistic update: remove from active, add to paused
      setActiveTimers((prev) =>
        prev.filter((t) => t.id !== timerId)
      );
      setPausedTimers((prev) => [
        ...prev,
        {
          ...activeTimer,
          pausedElapsed: 0,
        },
      ]);

      // Try to pause on server
      return api
        .pauseTimer(timerId)
        .then((paused) => {
          // Update with server response (includes pauses array)
          setPausedTimers((prev) =>
            prev.map((t) =>
              t.id === timerId
                ? {
                    ...t,
                    pauses: paused.pauses || [],
                  }
                : t
            )
          );
        })
        .catch((err) => {
          // Rollback on error
          console.error("Failed to pause timer:", err);
          setActiveTimers((prev) => [...prev, activeTimer]);
          setPausedTimers((prev) =>
            prev.filter((t) => t.id !== timerId)
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
          // Remove from paused timers and add to active
          setPausedTimers((prev) =>
            prev.filter((t) => t.id !== timerId)
          );
          setActiveTimers((prev) => [
            ...prev,
            {
              id: resumed.id,
              name: resumed.name,
              start: new Date(resumed.start),
              childId: resumed.child,
              pauses: resumed.pauses || [],
            },
          ]);
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
    const restored = s
      ? { id: s.id, name: s.name || "timer", start: new Date(s.start), childId: s.child }
      : stashed?.timer || stashed;
    if (!restored || (childId && restored.childId !== childId)) return;
    setActiveTimers((prev) =>
      prev.some((p) => p.id === timerId) ? prev : [...prev, restored]
    );
  }, [serverTimers, childId]);

  return { activeTimers, pausedTimers, elapsedMap, startTimer, stopTimer, resumeTimer, editTimer, discardTimer, pauseTimer, resumePausedTimer };
}
