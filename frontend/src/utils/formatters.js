import { FEEDING_TYPES, FEEDING_METHODS, BREAST_METHODS, BREAST_MILK_TYPES } from "./preferences";
import { agoAnchor } from "./overlayTime";
import en from "../locales/en";

// Several formatters below produce user-visible prose ("just now", "5m ago",
// "3mo 12d") and so need translating, but they're pure functions used outside
// React too. They take `t` as an optional last argument and fall back to
// English rather than rendering raw keys.
//
// Only the *words* are translated; the h/m/d unit letters are left alone, to
// match formatDuration() and the picture-frame overlay, which use them
// unlabelled everywhere.
function englishT(key, params = {}) {
  let text = en[key] || key;
  for (const [k, v] of Object.entries(params)) text = text.replace(`{{${k}}}`, v);
  return text;
}

// Dates and times are formatted by Intl, which needs a locale tag rather than a
// translated string — so the app's language picker has to reach it somehow.
//
// This is module state rather than another argument threaded through every
// aggregator, formatter and their call sites: the label a chart renders is also
// the key getEntriesForDay() looks rows up by, so the two must format
// identically, and a single shared setting guarantees that far more reliably
// than fifteen call sites each remembering to pass the same value.
//
// I18nProvider sets it whenever the locale changes. Undefined means "use the
// browser's locale", which is the behaviour before a language is ever picked.
let displayLocale;

export function setDisplayLocale(locale) {
  displayLocale = locale || undefined;
}

// For the handful of components that call toLocale*String directly.
export function getDisplayLocale() {
  return displayLocale;
}

// Chart bucket keys: one per known feeding type, plus "other" for the rest
export const FEEDING_COUNT_KEYS = [...FEEDING_TYPES.map((ft) => ft.value), "other"];

export function getAge(birthDate, t = englishT) {
  const birth = new Date(birthDate);
  const now = new Date();
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  const days = now.getDate() - birth.getDate();
  if (days < 0) months--;
  const adjustedDays = days < 0 ? 30 + days : days;
  if (months < 1)
    return t("age.days", { d: Math.max(0, Math.floor((now - birth) / 86400000)) });
  if (months < 12)
    return t("age.monthsDays", { mo: months, d: adjustedDays });
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0)
    return t("age.years", { y: years });
  return t("age.yearsMonths", { y: years, mo: remainingMonths });
}

export function formatElapsed(seconds) {
  const s = seconds % 60;
  const totalMinutes = Math.floor(seconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (n) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// elapsedSince returns the bare span since `dateStr` — "5m", "2h 10m",
// "3d 4h" — or null when it's under a minute.
//
// Separate from the wording so each language can place it: "5m ago" puts the
// span first, "hace 5m" and "vor 5m" put it last. No `${x} ago` template can
// do both.
export function elapsedSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (!Number.isFinite(mins) || mins < 1) return null;

  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins === 0 ? `${hours}h` : `${hours}h ${remMins}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}

export function timeAgo(dateStr, t = englishT) {
  const value = elapsedSince(dateStr);
  return value === null ? t("time.justNow") : t("time.ago", { value });
}

// lastSeenLabel is the Overview stat cards' "Last: 5m ago" line. Same elapsed
// span as timeAgo, phrased as "when did this last happen" rather than as a
// timestamp on a specific row.
export function lastSeenLabel(dateStr, t = englishT) {
  const value = elapsedSince(dateStr);
  return value === null ? t("time.justNow") : t("overview.lastEntry", { value });
}

// mostRecentAt returns when the newest entry in `entries` finished, as an
// epoch ms, or null for an empty set.
//
// "Finished" rather than "started": after a 40-minute feed you want to know it
// ended 5 minutes ago, not that it began 45 ago. agoAnchor picks end for
// duration entries and falls back to start (or time) for point ones.
//
// The list is scanned rather than indexed, because entries arrive ordered by
// start and the newest start isn't always the newest end.
export function mostRecentAt(entries = []) {
  let newest = null;
  for (const entry of entries) {
    const at = new Date(agoAnchor(entry)).getTime();
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(displayLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0];
}

// overlapHours returns how many hours of an entry's [start, end] range fall
// within the given window. Used by rolling "last 24 hours" totals so an
// overnight sleep that crosses the window boundary contributes only the
// portion that's actually inside the window, instead of either its whole
// duration (if start ∈ window) or nothing (if start ∉ window). Ongoing
// entries with no end are treated as ending right now.
export function overlapHours(entry, windowStartMs, windowEndMs) {
  if (!entry?.start) return 0;
  const startMs = new Date(entry.start).getTime();
  const endMs = entry.end ? new Date(entry.end).getTime() : Date.now();
  const overlapStart = Math.max(startMs, windowStartMs);
  const overlapEnd = Math.min(endMs, windowEndMs);
  return Math.max(0, (overlapEnd - overlapStart) / 3600000);
}

export function formatDuration(durationStr) {
  if (!durationStr) return "—";
  const hours = parseDuration(durationStr);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

// Renders a duration given in hours as "4h 39m" / "39m" / "2h". Distinct from
// formatDuration(), which takes the server's interval string and rounds to one
// decimal — too coarse for a feeding gap, where the minutes are the point.
export function formatHoursMinutes(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// A delta at or above this is treated as a hole in the log (a holiday, a
// device that wasn't used, a child added mid-way) rather than a real interval
// between feeds, and is dropped. Without the guard a single unlogged stretch
// dominates the mean: one 10-day gap among 200 four-hour gaps adds over an
// hour to the average.
const MAX_FEEDING_GAP_HOURS = 24;

// avgFeedingGap returns the mean time between consecutive feedings, in hours,
// or null when there aren't two comparable feeds. A per-day count says nothing
// about spacing — a day of tightly clustered feeds and one of evenly spread
// feeds produce the same "11 feedings/day".
export function avgFeedingGap(feedings) {
  const starts = feedings
    .map((f) => new Date(f.start).getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const hours = (starts[i] - starts[i - 1]) / 3600000;
    if (hours > 0 && hours < MAX_FEEDING_GAP_HOURS) gaps.push(hours);
  }
  if (!gaps.length) return null;
  return gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
}

// avgBreastDuration returns the mean nursing session length in hours, or null
// when no breastfeed in the set has a usable duration. Bottle feeds are
// excluded: for those the amount is the meaningful number, and averaging the
// two together would compare a measured feed against a timed one.
export function avgBreastDuration(feedings) {
  const durations = feedings
    .filter((f) => BREAST_METHODS.includes(f.method))
    .map((f) => parseDuration(f.duration))
    .filter((hours) => hours > 0);
  if (!durations.length) return null;
  return durations.reduce((sum, h) => sum + h, 0) / durations.length;
}

// stashOutflow returns the feeds that came out of the expressed-milk stash:
// bottles of breast milk or fortified breast milk. Nursing at the breast never
// touches the stash and formula never came from it.
//
// This has to agree with the type/method filter in models.GetMilkStock — the
// server computes the headline balance and the client computes the movement
// chart beside it, so a divergence shows up as a chart that doesn't add up to
// the number above it.
export function stashOutflow(feedings) {
  return feedings.filter(
    (f) => f.method === "bottle" && BREAST_MILK_TYPES.includes(f.type),
  );
}

// feedings.type and feedings.method are database enums ("left breast",
// "fortified breast milk"), not display text. Both already have i18n keys on
// FEEDING_TYPES/FEEDING_METHODS; these maps are what turns one into the other.
const FEEDING_TYPE_KEYS = Object.fromEntries(FEEDING_TYPES.map((x) => [x.value, x.labelKey]));
const FEEDING_METHOD_KEYS = Object.fromEntries(FEEDING_METHODS.map((x) => [x.value, x.labelKey]));

// Turns a feedings.method / feedings.type enum value into display text,
// falling back to the raw value for anything not in the enum.
export function feedingMethodLabel(method, t = englishT) {
  return FEEDING_METHOD_KEYS[method] ? t(FEEDING_METHOD_KEYS[method]) : method || "";
}

export function feedingTypeLabel(type, t = englishT) {
  return FEEDING_TYPE_KEYS[type] ? t(FEEDING_TYPE_KEYS[type]) : type || "";
}

export function toFeedingTimeline(feedings, volumeUnit = "mL", t = englishT) {
  return feedings.map((f) => {
    // Nursing sessions are timed rather than measured, so surface the session
    // length alongside the method. Bottle feeds already lead with their amount.
    const sessionHours = BREAST_METHODS.includes(f.method) ? parseDuration(f.duration) : 0;
    const how =
      (f.method && FEEDING_METHOD_KEYS[f.method] && t(FEEDING_METHOD_KEYS[f.method])) ||
      (f.type && FEEDING_TYPE_KEYS[f.type] && t(FEEDING_TYPE_KEYS[f.type])) ||
      f.method || f.type || "";
    const base =
      `${f.amount ? f.amount + " " + volumeUnit : ""} ${how}`.trim() || t("action.feeding");
    return {
      time: formatTime(f.end || f.start),
      label: sessionHours > 0 ? `${base} · ${formatHoursMinutes(sessionHours)}` : base,
      detail: timeAgo(f.end || f.start, t),
      amount: f.amount || 0,
      type: f.type,
      method: f.method,
      entry: f,
    };
  });
}

export function toDiaperTimeline(changes, t = englishT) {
  return changes.map((c) => ({
    time: formatTime(c.time),
    type: c.solid && c.wet ? "both" : c.solid ? "solid" : "wet",
    ago: timeAgo(c.time, t),
    color: c.color,
    entry: c,
  }));
}

export function toSleepBlocks(sleepEntries) {
  return sleepEntries.map((s) => ({
    start: formatTime(s.start),
    end: s.end ? formatTime(s.end) : "ongoing",
    duration: parseDuration(s.duration),
    nap: s.nap,
    entry: s,
  }));
}

export function toPumpingTimeline(sessions, volumeUnit = "mL", t = englishT) {
  return sessions.map((p) => ({
    time: formatTime(p.end || p.start),
    label: p.amount ? `${p.amount} ${volumeUnit}` : formatDuration(p.duration),
    detail: timeAgo(p.end || p.start, t),
    amount: p.amount || 0,
    entry: p,
  }));
}

export function toNoteTimeline(notes, t = englishT) {
  return notes.map((n) => ({
    time: formatTime(n.time),
    text: n.note,
    ago: timeAgo(n.time, t),
    entry: n,
  }));
}

export function toGrowthSeries(entries, valueKey) {
  return entries
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e) => ({
      timestamp: new Date(e.date).getTime(),
      date: new Date(e.date).toLocaleDateString(displayLocale, {
        month: "short",
        day: "numeric",
      }),
      [valueKey]: parseFloat(e[valueKey]),
      entry: e,
    }));
}

export function formatGrowthTick(timestamp) {
  return new Date(timestamp).toLocaleDateString(displayLocale, {
    month: "short",
    day: "numeric",
  });
}

function getLast7Days() {
  const result = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push({
      // Locale-formatted rather than a hardcoded English array, matching every
      // other date label in the app. The label doubles as the lookup key in
      // getEntriesForDay(), so both sides must format it the same way — they
      // do, because both go through this function.
      label: d.toLocaleDateString(displayLocale, { weekday: "short" }),
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

function entryDateStr(dateVal) {
  const d = new Date(dateVal);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function aggregateByDayOfWeek(entries, valueKey, dateKey = "start") {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e[valueKey] || 0);
  });
  return days.map((d) => ({ day: d.label, amount: Math.round(sums[d.dateStr]) }));
}

export function aggregateSleepByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    for (const d of days) {
      const dayStartMs = new Date(`${d.dateStr}T00:00:00`).getTime();
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
      sums[d.dateStr] += overlapHours(e, dayStartMs, dayEndMs);
    }
  });
  return days.map((d) => ({ day: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
}

export function aggregateTummyByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start);
    if (key in sums) sums[key] += parseDuration(e.duration) * 60;
  });
  return days.map((d) => ({ day: d.label, minutes: Math.round(sums[d.dateStr]) }));
}

function getLastNDays(n) {
  const result = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const month = d.toLocaleDateString(displayLocale, { month: "short", day: "numeric" });
    result.push({
      label: month,
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

// Generic amount-per-day aggregator over the last N days; used for the
// 30-day feeding and pumping trend charts.
export function dailyAmountTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e.amount || 0);
  });
  const result = days.map((d) => ({ date: d.label, amount: Math.round(sums[d.dateStr]) }));
  const firstNonZero = result.findIndex((d) => d.amount > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

// Generic entries-per-day counter over the last N days; used for the
// 30-day pumping count chart. Leading zero-only days are trimmed.
export function dailyCounts(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    if (key in sums) sums[key] += 1;
  });
  const result = days.map((d) => ({ date: d.label, count: sums[d.dateStr] }));
  const firstNonZero = result.findIndex((d) => d.count > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

export function getEntriesForDay(entries, dayLabel, dateKey = "start") {
  const days = getLast7Days();
  const targetDay = days.find((d) => d.label === dayLabel);
  if (!targetDay) return [];

  return entries.filter((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    return key === targetDay.dateStr;
  });
}

export function getEntriesForDate(entries, dateLabel, dateKey = "start") {
  const targetDate = dateLabel; // Already in format like "Jan 15"
  return entries.filter((e) => {
    const entryDate = new Date(e[dateKey] || e.time || e.date);
    const formattedDate = entryDate.toLocaleDateString(displayLocale, {
      month: "short",
      day: "numeric",
    });
    return formattedDate === targetDate;
  });
}

/**
 * Aggregate feeding counts per day over the last N days, grouped by feeding
 * type. Returns an array of objects with one numeric key per bucket in
 * FEEDING_COUNT_KEYS, e.g. { date, "breast milk": 2, formula: 1, ..., other: 0 },
 * suitable for a Recharts stacked bar. Entries whose `type` isn't a known
 * feeding type are counted under "other". Leading zero-only days are trimmed.
 */
export function dailyFeedingCountsByType(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = {}));

  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    if (!(key in sums)) return;
    const type = FEEDING_COUNT_KEYS.includes(e.type) ? e.type : "other";
    sums[key][type] = (sums[key][type] || 0) + 1;
  });

  const result = days.map((d) => {
    const base = { date: d.label };
    for (const type of FEEDING_COUNT_KEYS) {
      base[type] = sums[d.dateStr][type] || 0;
    }
    return base;
  });

  const firstNonZero = result.findIndex((d) => FEEDING_COUNT_KEYS.some((t) => d[t] > 0));
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

export function dailySleepTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    for (const d of days) {
      const dayStartMs = new Date(`${d.dateStr}T00:00:00`).getTime();
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
      sums[d.dateStr] += overlapHours(e, dayStartMs, dayEndMs);
    }
  });
  const result = days.map((d) => ({ date: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
  const firstNonZero = result.findIndex((d) => d.hours > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}
