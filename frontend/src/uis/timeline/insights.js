// The numbers behind the Timeline UI: what usually happens, worked out from the
// last week of entries. Every function is pure and takes "now" as an argument,
// and each returns null when there is too little data to say anything —
// a guess from two feeds is worse than no guess.

const HOUR = 3600000;
const DAY = 24 * HOUR;

const time = (value) => {
  // new Date(null) is 1970, not "no date": a sleep still going has end: null.
  if (value === null || value === undefined || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// feedRhythm describes how feeds are usually spaced: the median gap between
// the starts of consecutive feeds, and from that when the next one would
// usually come. The median, not the mean: one long night stretch among
// three-hourly daytime feeds shouldn't push the estimate out.
//
// Needs four gaps. Gaps over twelve hours are holes in the log, not rhythm.
export function feedRhythm(feedings = []) {
  const starts = feedings.map((f) => time(f.start)).filter((ms) => ms !== null).sort((a, b) => a - b);
  if (!starts.length) return null;
  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    if (gap > 0 && gap <= 12 * HOUR) gaps.push(gap);
  }
  const last = starts[starts.length - 1];
  if (gaps.length < 4) return { last, gapMs: null, nextAt: null };
  const gapMs = median(gaps);
  return { last, gapMs, nextAt: last + gapMs };
}

// awakeWindow is how long the baby is usually awake before the next sleep:
// the median stretch between one sleep ending and the next starting. Needs
// three stretches; anything over twelve hours is a gap in the log.
export function awakeWindow(sleeps = []) {
  const spans = sleeps
    .map((s) => ({ start: time(s.start), end: time(s.end) }))
    .filter((s) => s.start !== null && s.end !== null && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const windows = [];
  for (let i = 1; i < spans.length; i++) {
    const awake = spans[i].start - spans[i - 1].end;
    if (awake > 0 && awake <= 12 * HOUR) windows.push(awake);
  }
  return windows.length >= 3 ? median(windows) : null;
}

// lastWoke is when the most recent finished sleep ended, or null.
export function lastWoke(sleeps = []) {
  let newest = null;
  for (const s of sleeps) {
    const end = time(s.end);
    if (end !== null && (newest === null || end > newest)) newest = end;
  }
  return newest;
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// sleepBetween is how much of the sleeps falls inside [from, to), in ms. A
// sleep still going (no end) counts up to `to`. Paused time is taken as
// spread evenly over the sleep, as the rest of the app does.
export function sleepBetween(sleeps = [], from, to) {
  let total = 0;
  for (const s of sleeps) {
    const start = time(s.start);
    if (start === null) continue;
    const end = time(s.end) ?? to;
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap <= 0) continue;
    const span = end - start;
    const paused = (Number(s.paused_seconds) || 0) * 1000;
    total += span > 0 && paused > 0 ? overlap * (Math.max(0, span - paused) / span) : overlap;
  }
  return total;
}

// byNow compares today so far with the same stretch of earlier days: `today`
// is the figure since midnight, `usual` the average of the figure up to this
// clock time on each earlier day that has any entries at all. "3 feeds, and
// it's usually 3 by now" says more than a daily total that is always behind
// until bedtime.
//
// `measure(from, to)` returns the figure for a window; `hasData(from, to)`
// says whether a day was tracked at all, so days before tracking began (or
// skipped entirely) don't drag the average to zero. `usual` is null with
// fewer than two such days.
export function byNow(measure, hasData, now, days = 6) {
  const midnight = startOfDay(now);
  const elapsed = now - midnight;
  const today = measure(midnight, now);
  const earlier = [];
  for (let i = 1; i <= days; i++) {
    // Step back by calendar day, not 24 hours, so a clock change can't
    // misalign the windows.
    const d = new Date(midnight);
    d.setDate(d.getDate() - i);
    const from = d.getTime();
    if (!hasData(from, from + DAY)) continue;
    earlier.push(measure(from, from + elapsed));
  }
  const usual = earlier.length >= 2 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null;
  return { today, usual };
}

export const countBetween = (entries = [], field) => (from, to) =>
  entries.reduce((n, e) => {
    const at = time(e[field]);
    return at !== null && at >= from && at < to ? n + 1 : n;
  }, 0);

// ribbonMarks lays the last `hours` out on a 0..1 scale for the day ribbon:
// sleep as [from, to] spans (clipped to the window, an ongoing sleep running
// to "now"), everything else as points.
export function ribbonMarks({ sleeps = [], feedings = [], changes = [], asleepSince = null }, now, hours = 24) {
  const from = now - hours * HOUR;
  const x = (ms) => (ms - from) / (now - from);
  const inside = (ms) => ms !== null && ms >= from && ms <= now;

  const spans = [];
  for (const s of sleeps) {
    const start = time(s.start);
    const end = time(s.end);
    if (start === null || end === null || end <= from || start >= now) continue;
    spans.push({ from: x(Math.max(start, from)), to: x(Math.min(end, now)), nap: !!s.nap });
  }
  if (asleepSince !== null && asleepSince < now) {
    spans.push({ from: x(Math.max(asleepSince, from)), to: 1, ongoing: true });
  }

  const points = (entries, field) =>
    entries.map((e) => ({ at: time(e[field]), entry: e })).filter((p) => inside(p.at)).map((p) => ({ x: x(p.at), entry: p.entry }));

  // Hour ticks on whole local hours, every three hours.
  const ticks = [];
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= now; t += HOUR) {
    const hour = new Date(t).getHours();
    if (t >= from && hour % 3 === 0) ticks.push({ x: x(t), hour });
  }

  return { sleep: spans, feeds: points(feedings, "start"), diapers: points(changes, "time"), ticks };
}

// usualFeeds picks the feeds worth a one-tap button: the kinds logged most in
// the set (type + method), each carrying the amount it had last time. A
// family that gives 120 mL bottles and nurses on the left sees exactly those
// two buttons, without setting anything up.
//
// Ties go to the kind logged most recently. Returns at most `max`, possibly
// none — the caller supplies a starting set for a baby with no feeds yet.
export function usualFeeds(feedings = [], max = 3) {
  const kinds = new Map();
  for (const f of feedings) {
    if (!f.type || !f.method) continue;
    const at = time(f.start);
    if (at === null) continue;
    const key = `${f.type}|${f.method}`;
    const kind = kinds.get(key) || { type: f.type, method: f.method, count: 0, latest: -Infinity, amount: null };
    kind.count += 1;
    if (at > kind.latest) {
      kind.latest = at;
      kind.amount = Number(f.amount) > 0 ? Number(f.amount) : null;
    }
    kinds.set(key, kind);
  }
  return [...kinds.values()]
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .slice(0, max)
    .map(({ type, method, amount }) => ({ type, method, amount }));
}

// nextSleepAt is when the next sleep would usually start: the last wake-up
// plus the usual stretch awake. Null without both.
export function nextSleepAt(sleeps = []) {
  const woke = lastWoke(sleeps);
  const usual = awakeWindow(sleeps);
  return woke !== null && usual !== null ? woke + usual : null;
}
