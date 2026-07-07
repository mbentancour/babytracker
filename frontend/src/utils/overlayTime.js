// Pure time helpers for the picture-frame status overlay. Kept separate from
// the component so they can be unit-tested without importing React.

// agoAnchor picks the timestamp a "last X" line should count from. For
// duration-based entries (feeding, sleep) that's the *end* time — when the
// activity finished — falling back to the start for an entry with no valid
// end (e.g. still ongoing). Point-in-time entries (diaper) only have `time`.
export function agoAnchor(item) {
  if (item.end && item.start) {
    const e = new Date(item.end).getTime();
    const s = new Date(item.start).getTime();
    if (!isNaN(e) && e >= s) return item.end; // real end time
  }
  return item.start || item.time;
}

// formatAwake renders a compact elapsed duration like "1h30m", "45m", "2d3h".
export function formatAwake(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1m";
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}
