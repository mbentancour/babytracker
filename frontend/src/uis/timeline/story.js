// Turns the lists of entries the app loads (feedings, sleep, diapers, …) into
// one chronological story of the day, the way you would tell it:
//
//   07:05  Bottle · 120 mL
//   09:09  Fell asleep
//   10:19  Woke up · slept 1h 10m
//
// A sleep is told as two moments, falling asleep and waking, because that is
// how it happened and it puts "woke up" where it belongs in the order — which
// is also what the "awake for 1h 28m" at the top is counted from.
//
// Anything else that took a while (a feed, tummy time, pumping) is one line,
// told when it ended: the moment every "… ago" in the app counts from. A feed
// logged as "just now" is recorded as the quarter of an hour before that; told
// by its start it would sit a quarter of an hour up the page, above a diaper
// or a wake-up logged in between.
//
// Pure functions: no React, no API. Text is produced by describeRow, which
// takes the translator and the unit labels as arguments.

import { formatHoursMinutes, feedingMethodLabel, feedingTypeLabel } from "../../utils/formatters";
import { agoAnchor } from "../../utils/overlayTime";
import { sidesText } from "../../utils/sides";

const HOUR = 3600000;
const pad = (n) => String(n).padStart(2, "0");

// A timestamp as epoch milliseconds, or null when there is none to read.
// (new Date(null) is 1970, not "no date", hence the explicit check.)
export const time = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// How long until the minute after `ms` begins, with a little to spare so a
// timer set for it cannot fire a moment early and read the old minute again.
export const nextMinuteIn = (ms) => 60000 - (ms % 60000) + 20;

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// newest is the entry that happened last, going by the moment "… ago" counts
// from (its end, if it has one), or null for an empty list.
export function newest(entries = []) {
  let best = null;
  let bestAt = -Infinity;
  for (const entry of entries) {
    const at = time(agoAnchor(entry));
    if (at !== null && at > bestAt) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

// Entries told as one line, and the field that holds their time (their start,
// for those that also have an end).
const MOMENTS = [
  ["feeding", "feedings", "start"],
  ["diaper", "changes", "time"],
  ["tummy", "tummyTimes", "start"],
  ["pumping", "pumping", "start"],
  ["milkWaste", "milkWaste", "time"],
  ["temp", "temperatures", "time"],
  ["medication", "medications", "time"],
  ["note", "notes", "time"],
];

// Entries that belong to a date but have no time of day.
const DATED = [
  ["weight", "weights"],
  ["height", "heights"],
  ["headcirc", "headCircumferences"],
  ["bmi", "bmiEntries"],
  ["milestone", "milestones"],
];

// When several things share a minute, tell them in this order.
const ORDER = ["sleep", "feeding", "diaper", "tummy", "pumping", "milkWaste", "temp", "medication", "note"];

// buildRows lists every moment from `from` on, oldest first. `timers` are the
// running timers ({ id, kind, start }); each becomes a live row.
export function buildRows(lists, { from = -Infinity, timers = [] } = {}) {
  const rows = [];
  for (const [kind, list] of MOMENTS) {
    for (const entry of lists[list] || []) {
      // Its end if it has one, otherwise the one time it has.
      const at = time(agoAnchor(entry));
      if (at === null || at < from) continue;
      rows.push({ key: `${kind}-${entry.id}`, id: `${kind}-${entry.id}`, kind, at, entry });
    }
  }
  for (const entry of lists.sleeps || []) {
    const start = time(entry.start);
    const end = time(entry.end);
    const id = `sleep-${entry.id}`;
    if (start !== null && start >= from) rows.push({ key: `${id}-start`, id, kind: "sleep", part: "start", at: start, entry });
    if (end !== null && end >= from) rows.push({ key: `${id}-end`, id, kind: "sleep", part: "end", at: end, entry });
  }
  for (const timer of timers) {
    const at = time(timer.start);
    if (at === null) continue;
    rows.push({
      key: `timer-${timer.id}`,
      id: `timer-${timer.id}`,
      kind: timer.kind,
      part: timer.kind === "sleep" ? "start" : undefined,
      at,
      live: true,
      timer,
    });
  }
  return rows.sort((a, b) => a.at - b.at || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// buildDated lists the date-only entries (a weight, a milestone) from the day
// of `from` on, each with the day it belongs to.
export function buildDated(lists, { from = -Infinity } = {}) {
  const first = Number.isFinite(from) ? dayKey(from) : "";
  const items = [];
  for (const [kind, list] of DATED) {
    for (const entry of lists[list] || []) {
      const day = typeof entry.date === "string" ? entry.date.slice(0, 10) : null;
      if (!day || day < first) continue;
      items.push({ key: `${kind}-${entry.id}`, id: `${kind}-${entry.id}`, kind, day, entry });
    }
  }
  return items;
}

// groupDays splits the story into days, oldest first. Days with nothing in
// them are left out, except today, which is always there to be written on.
export function groupDays(rows, dated, now) {
  const days = new Map();
  const dayOf = (key, ms) => {
    if (!days.has(key)) days.set(key, { key, start: ms, rows: [], dated: [] });
    return days.get(key);
  };
  for (const row of rows) dayOf(dayKey(row.at), startOfDay(row.at)).rows.push(row);
  for (const item of dated) {
    const [y, m, d] = item.day.split("-").map(Number);
    dayOf(item.day, new Date(y, m - 1, d).getTime()).dated.push(item);
  }
  dayOf(dayKey(now), startOfDay(now));
  return [...days.values()].sort((a, b) => a.start - b.start);
}

// markSleep notes on every row whether the baby was asleep just before it and
// just after it, so the stream can draw the stretch from "fell asleep" to
// "woke up" as one block — also when the falling asleep happened before the
// first row shown, or the waking hasn't happened yet.
export function markSleep(rows) {
  const starts = new Set(rows.filter((r) => r.kind === "sleep" && r.part === "start").map((r) => r.id));
  // Sleeps already under way when the story begins.
  const asleep = new Set(rows.filter((r) => r.kind === "sleep" && r.part === "end" && !starts.has(r.id)).map((r) => r.id));
  return rows.map((row) => {
    const asleepBefore = asleep.size > 0;
    if (row.kind === "sleep") {
      if (row.part === "start") asleep.add(row.id);
      else asleep.delete(row.id);
    }
    return { ...row, asleepBefore, asleepAfter: asleep.size > 0 };
  });
}

// timerElapsed is how long a timer has run, in whole seconds, not counting
// its pauses. A paused timer stands still at the moment it was paused.
export function timerElapsed(timer, now) {
  const start = time(timer.start);
  if (start === null) return 0;
  let paused = 0;
  let until = now;
  for (const pause of timer.pauses || []) {
    const from = time(pause.start);
    const to = time(pause.end);
    if (from === null) continue;
    if (to === null) until = Math.min(until, from);
    else paused += to - from;
  }
  return Math.max(0, Math.floor((until - start - paused) / 1000));
}

const MINUTE = 60000;
const WHEN = Object.fromEntries(MOMENTS.map(([kind, , field]) => [kind, field]));

// nudged works out what moving a row by `minutes` does to its entry: the
// fields that change, as epoch milliseconds, or null when the move makes no
// sense — into the future, or a sleep's end past its start.
//
// A row moves the way it reads. "Woke up" moves the waking and leaves the
// falling asleep where it was; a feed keeps its length and moves whole; a
// running timer moves its start.
export function nudged(row, minutes, now) {
  const delta = minutes * MINUTE;
  if (row.live) {
    const start = time(row.timer?.start);
    return start !== null && start + delta <= now ? { start: start + delta } : null;
  }
  const entry = row.entry || {};
  const start = time(entry.start);
  const end = time(entry.end);
  if (row.kind === "sleep") {
    if (start === null) return null;
    if (row.part === "end") {
      return end !== null && end + delta > start && end + delta <= now ? { end: end + delta } : null;
    }
    return end === null || start + delta < end ? { start: start + delta } : null;
  }
  if (WHEN[row.kind] === "start") {
    if (start === null || Math.max(start, end ?? start) + delta > now) return null;
    return end === null ? { start: start + delta } : { start: start + delta, end: end + delta };
  }
  const at = time(entry.time);
  return WHEN[row.kind] === "time" && at !== null && at + delta <= now ? { time: at + delta } : null;
}

// gapBefore says how much breathing room a row gets above it, in px: a little
// more after a long quiet stretch, so the page keeps some of the day's rhythm
// without turning into a ruler. Capped, and 0 for things minutes apart.
export function gapBefore(previousAt, at) {
  if (previousAt === null || previousAt === undefined) return 0;
  const minutes = (at - previousAt) / 60000;
  return Math.round(Math.max(0, Math.min(22, (minutes - 20) / 10)));
}

const amount = (value, unit) => `${Number(value)} ${unit}`;

export function sleepLength(entry) {
  const start = time(entry.start);
  const end = time(entry.end);
  if (start === null || end === null || end <= start) return null;
  const net = end - start - (Number(entry.paused_seconds) || 0) * 1000;
  return net >= 60000 ? formatHoursMinutes(net / HOUR) : null;
}

const spanLength = (entry) => {
  const start = time(entry.start);
  const end = time(entry.end);
  if (start === null || end === null || end - start < 60000) return null;
  return formatHoursMinutes((end - start) / HOUR);
};

const join = (...parts) => parts.filter(Boolean).join(" · ");

// describeRow gives a row its words: a title, and a quieter second line.
export function describeRow(row, { t, units }) {
  const e = row.entry || {};
  switch (row.kind) {
    case "feeding": {
      if (row.live) return { title: t("timer.feeding") };
      if (e.type === "solid food") {
        return { title: feedingTypeLabel(e.type, t), detail: feedingMethodLabel(e.method, t) };
      }
      const how = feedingMethodLabel(e.method, t);
      const what = feedingTypeLabel(e.type, t);
      if (e.method === "bottle") {
        return { title: join(how, Number(e.amount) > 0 && amount(e.amount, units.volume)), detail: what };
      }
      // How long each side took, when a feed on both breasts says.
      return { title: join(how, spanLength(e)), detail: join(e.type !== "breast milk" && what, sidesText(e, { t, volume: units.volume })) || null };
    }
    case "sleep": {
      if (row.live || row.part === "start") return { title: t("simple.fellAsleep") };
      const length = sleepLength(e);
      return {
        title: t("simple.wokeUp"),
        detail: join(length && t("timeline.slept", { value: length }), t(e.nap ? "sleep.nap" : "sleep.night")),
      };
    }
    case "diaper":
      return { title: join(t("action.diaper"), t(e.wet && e.solid ? "diaper.both" : e.solid ? "diaper.solid" : "diaper.wet")) };
    case "tummy":
      return { title: row.live ? t("timer.tummy") : join(t("timer.tummy"), spanLength(e)) };
    case "pumping":
      return {
        title: join(t("action.pumping"), Number(e.amount) > 0 ? amount(e.amount, units.volume) : spanLength(e)),
        // What each breast gave, for a session logged side by side.
        detail: sidesText(e, { t, volume: units.volume }),
      };
    case "milkWaste":
      return { title: join(t("action.milkWaste"), Number(e.amount) > 0 && amount(e.amount, units.volume)) };
    case "temp":
      return { title: join(t("action.temp"), e.temperature != null && amount(e.temperature, units.temp)) };
    case "medication":
      return { title: e.name || t("action.medication"), detail: e.dosage ? `${e.dosage} ${e.dosage_unit || ""}`.trim() : null };
    case "note":
      return { title: e.note || t("action.note") };
    case "weight":
      return { title: join(t("action.weight"), e.weight != null && amount(e.weight, units.weight)) };
    case "height":
      return { title: join(t("action.height"), e.height != null && amount(e.height, units.length)) };
    case "headcirc":
      return { title: join(t("action.headCirc"), e.head_circumference != null && amount(e.head_circumference, units.length)) };
    case "bmi":
      return { title: join(t("action.bmi"), e.bmi != null && String(e.bmi)) };
    case "milestone":
      return { title: e.title || t("action.milestone") };
    default:
      return { title: row.kind };
  }
}
