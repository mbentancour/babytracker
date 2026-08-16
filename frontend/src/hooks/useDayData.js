import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import { localInputToUTC } from "../utils/datetime";

// One arbitrary day's entries, across every type.
//
// Deliberately separate from useBabyData: that hook fires 20+ requests on a
// 30-second poll against fixed today/7-day/30-day windows, and this one needs
// a window the user picks and only while the Day tab is open. Folding it in
// would make every household pay for a view most of them may have switched
// off, and would re-fetch the whole dashboard every time you pressed "previous
// day".
//
// The day boundary is local wall-clock — "Tuesday" means the user's Tuesday —
// but the API parses timestamps as UTC. Getting that conversion wrong silently
// drops entries by the size of the UTC offset at each end of the day rather
// than failing loudly, so both bounds go through localInputToUTC. See the same
// treatment in useBabyData.

const pad = (n) => String(n).padStart(2, "0");

export function toLocalDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const emptyPage = { results: [] };

export function useDayData(childId, date, canRead = () => true, { milkStockEnabled = false } = {}) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Pressing "previous day" repeatedly starts overlapping fetches; only the
  // most recent may apply, or the view lands on whichever response happens to
  // arrive last.
  const seqRef = useRef(0);

  const dayKey = date ? toLocalDateKey(date) : null;
  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;

  const fetchDay = useCallback(async () => {
    if (!childId || !dayKey) return;
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;

    setLoading(true);
    const min = localInputToUTC(`${dayKey}T00:00:00`);
    const max = localInputToUTC(`${dayKey}T23:59:59`);

    // Sleep and tummy time can start the previous evening and run into this
    // day. Reach back far enough to catch them; the view filters by overlap,
    // so the extra rows cost nothing.
    const prev = new Date(`${dayKey}T00:00:00`);
    prev.setDate(prev.getDate() - 1);
    const spanMin = localInputToUTC(`${toLocalDateKey(prev)}T00:00:00`);

    // Takes a thunk, not a promise: an argument would be evaluated before the
    // permission check could skip it, so the request would fire either way and
    // only its result would be thrown away.
    const q = (feature, call) => (canReadRef.current(feature) ? call() : Promise.resolve(emptyPage));
    const page = { limit: 200 };

    try {
      const [
        feedings, sleepEntries, changes, tummyTimes, pumping,
        temperatures, medications, notes, milestones,
        weights, heights, headCircumferences, bmiEntries, milkWaste,
      ] = await Promise.all([
        q("feeding", () => api.getFeedings({ child: childId, start_min: min, start_max: max, ordering: "start", ...page })),
        q("sleep", () => api.getSleep({ child: childId, start_min: spanMin, start_max: max, ordering: "start", ...page })),
        q("diaper", () => api.getChanges({ child: childId, date_min: min, date_max: max, ordering: "time", ...page })),
        q("tummy", () => api.getTummyTimes({ child: childId, start_min: spanMin, start_max: max, ordering: "start", ...page })),
        q("pumping", () => api.getPumping({ child: childId, start_min: min, start_max: max, ordering: "start", ...page })),
        q("temp", () => api.getTemperature({ child: childId, date_min: min, date_max: max, ordering: "time", ...page })),
        q("medication", () => api.getMedications({ child: childId, date_min: min, date_max: max, ordering: "time", ...page })),
        q("note", () => api.getNotes({ child: childId, date_min: min, date_max: max, ordering: "time", ...page })),
        // Measurements and milestones are date-only (no time component), so
        // they filter on the plain local date rather than a UTC instant.
        q("milestone", () => api.getMilestones({ child: childId, date_min: dayKey, date_max: dayKey, ordering: "date", ...page })),
        q("weight", () => api.getWeight({ child: childId, date_min: dayKey, date_max: dayKey, ordering: "date", ...page })),
        q("height", () => api.getHeight({ child: childId, date_min: dayKey, date_max: dayKey, ordering: "date", ...page })),
        q("headcirc", () => api.getHeadCircumference({ child: childId, date_min: dayKey, date_max: dayKey, ordering: "date", ...page })),
        q("bmi", () => api.getBMI({ child: childId, date_min: dayKey, date_max: dayKey, ordering: "date", ...page })),
        milkStockEnabled && canReadRef.current("pumping")
          ? api.getMilkWaste({ child: childId, date_min: min, date_max: max, ordering: "time", ...page })
          : Promise.resolve(emptyPage),
      ]);

      if (stale()) return;
      setEntries({
        feedings: feedings.results || [],
        sleepEntries: sleepEntries.results || [],
        changes: changes.results || [],
        tummyTimes: tummyTimes.results || [],
        pumping: pumping.results || [],
        temperatures: temperatures.results || [],
        medications: medications.results || [],
        notes: notes.results || [],
        milestones: milestones.results || [],
        weights: weights.results || [],
        heights: heights.results || [],
        headCircumferences: headCircumferences.results || [],
        bmiEntries: bmiEntries.results || [],
        milkWaste: milkWaste.results || [],
      });
      setError(null);
    } catch (err) {
      if (!stale()) setError(err.message);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [childId, dayKey, milkStockEnabled]);

  useEffect(() => { fetchDay(); }, [fetchDay]);

  return { entries, loading, error, refetch: fetchDay };
}
