import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import { localInputToUTC } from "../utils/datetime";
import { toLocalDateKey } from "./useDayData";

// The last N days of the five timed/point activities the routine grid plots.
//
// Separate from useBabyData for the same reason as useDayData: it only runs
// while the Routine tab is open, so households that leave the view off pay
// nothing. It also needs more than the single day of diaper changes that
// useBabyData fetches.
//
// The window is caller-chosen (see ROUTINE_PERIODS): a week is too short to
// read a rhythm off, and the whole point of the view is watching one shift.
export const ROUTINE_DAYS = 14;

const emptyPage = { results: [] };

export function useRoutineData(childId, canRead = () => true, days = ROUTINE_DAYS) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seqRef = useRef(0);
  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;

  const fetchRoutine = useCallback(async () => {
    if (!childId) return;
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;
    setLoading(true);

    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    const min = localInputToUTC(`${toLocalDateKey(from)}T00:00:00`);

    // Sleep and tummy time can start the evening before the window and run
    // into it, so they reach back one more day. Marks outside the grid are
    // simply not drawn.
    const spanFrom = new Date(from);
    spanFrom.setDate(spanFrom.getDate() - 1);
    const spanMin = localInputToUTC(`${toLocalDateKey(spanFrom)}T00:00:00`);

    // Takes a thunk, not a promise: an argument would be evaluated before the
    // permission check could skip it, so the request would fire either way and
    // only its result would be thrown away.
    const q = (feature, call) => (canReadRef.current(feature) ? call() : Promise.resolve(emptyPage));
    // A month of a busy household is roughly 300 feeds and 150 changes, so
    // ask for the API's ceiling rather than silently truncating the oldest
    // days of the very window the user widened to see.
    const page = { limit: 1000 };

    try {
      const [feedings, sleepEntries, changes, tummyTimes, pumping] = await Promise.all([
        q("feeding", () => api.getFeedings({ child: childId, start_min: min, ordering: "start", ...page })),
        q("sleep", () => api.getSleep({ child: childId, start_min: spanMin, ordering: "start", ...page })),
        q("diaper", () => api.getChanges({ child: childId, date_min: min, ordering: "time", ...page })),
        q("tummy", () => api.getTummyTimes({ child: childId, start_min: spanMin, ordering: "start", ...page })),
        q("pumping", () => api.getPumping({ child: childId, start_min: min, ordering: "start", ...page })),
      ]);

      if (stale()) return;
      setEntries({
        feedings: feedings.results || [],
        sleepEntries: sleepEntries.results || [],
        changes: changes.results || [],
        tummyTimes: tummyTimes.results || [],
        pumping: pumping.results || [],
      });
      setError(null);
    } catch (err) {
      if (!stale()) setError(err.message);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [childId, days]);

  useEffect(() => { fetchRoutine(); }, [fetchRoutine]);

  return { entries, loading, error, refetch: fetchRoutine };
}
