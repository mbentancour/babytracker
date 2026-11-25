import { describe, it, expect } from "vitest";
import { buildRows, buildDated, groupDays, gapBefore, markSleep, timerElapsed, nudged, sleepLength, describeRow, dayKey } from "./story";
import en from "../../locales/en";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const ms = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const t = (key, params = {}) => Object.entries(params).reduce((text, [k, v]) => text.replace(`{{${k}}}`, v), en[key] || key);
const units = { volume: "mL", weight: "kg", length: "cm", temp: "°C" };
const say = (row) => describeRow(row, { t, units });

const lists = {
  feedings: [
    { id: 1, start: at(22, 7, 5), end: at(22, 7, 5), type: "breast milk", method: "bottle", amount: 120 },
    { id: 2, start: at(22, 11), end: at(22, 11, 14), type: "breast milk", method: "left breast" },
  ],
  sleeps: [
    { id: 5, start: at(21, 19, 40), end: at(22, 6, 30), nap: false },
    { id: 6, start: at(22, 9, 9), end: at(22, 10, 19), nap: true },
  ],
  changes: [{ id: 3, time: at(22, 7, 5), wet: true, solid: false }],
  weights: [{ id: 8, date: "2026-10-22", weight: 6.2 }],
  milestones: [{ id: 9, date: "2026-10-20T00:00:00Z", title: "First smile" }],
};

describe("buildRows", () => {
  it("tells the day in order, a sleep as two moments", () => {
    const rows = buildRows(lists, { from: ms(22, 0) });
    expect(rows.map((r) => r.key)).toEqual([
      "sleep-5-end", "feeding-1", "diaper-3", "sleep-6-start", "sleep-6-end", "feeding-2",
    ]);
    expect(rows[0]).toMatchObject({ id: "sleep-5", kind: "sleep", part: "end", at: ms(22, 6, 30) });
  });

  it("puts a sleep before a feed logged the same minute, and leaves out what came before the window", () => {
    const rows = buildRows({ ...lists, sleeps: [{ id: 7, start: at(22, 7, 5), end: at(22, 8) }] }, { from: ms(22, 7) });
    expect(rows.map((r) => r.key)).toEqual(["sleep-7-start", "feeding-1", "diaper-3", "sleep-7-end", "feeding-2"]);
  });

  it("adds running timers as live rows", () => {
    const rows = buildRows({}, { timers: [{ id: 4, kind: "sleep", start: at(22, 13) }, { id: 5, kind: "feeding", start: at(22, 13, 30) }] });
    expect(rows).toMatchObject([
      { key: "timer-4", kind: "sleep", part: "start", live: true },
      { key: "timer-5", kind: "feeding", live: true },
    ]);
    expect(rows[1].part).toBeUndefined();
  });

  it("skips entries with no readable time", () => {
    expect(buildRows({ feedings: [{ id: 1, start: "nonsense" }], changes: [{ id: 2 }] })).toEqual([]);
  });
});

describe("days", () => {
  it("gives date-only entries a day, from the window's first day on", () => {
    expect(buildDated(lists, { from: ms(22, 9) })).toMatchObject([{ key: "weight-8", kind: "weight", day: "2026-10-22" }]);
    expect(buildDated(lists).map((d) => d.day)).toEqual(["2026-10-22", "2026-10-20"]);
  });

  it("groups rows and dated entries by day, oldest first, and always has today", () => {
    const rows = buildRows(lists, { from: ms(21, 0) });
    const days = groupDays(rows, buildDated(lists), ms(23, 8));
    expect(days.map((d) => d.key)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(days[0].dated.map((d) => d.key)).toEqual(["milestone-9"]);
    expect(days[1].rows.map((r) => r.key)).toEqual(["sleep-5-start"]);
    expect(days[3].rows).toEqual([]);
    expect(days[2].start).toBe(ms(22, 0));
    expect(dayKey(ms(22, 23, 59))).toBe("2026-10-22");
  });

  it("leaves a little more room after a long quiet stretch", () => {
    expect(gapBefore(null, ms(22, 7))).toBe(0);
    expect(gapBefore(ms(22, 7), ms(22, 7, 10))).toBe(0);
    expect(gapBefore(ms(22, 7), ms(22, 8))).toBe(4);
    expect(gapBefore(ms(22, 7), ms(22, 19))).toBe(22);
  });
});

describe("markSleep", () => {
  it("knows which stretches were slept through", () => {
    const rows = markSleep(buildRows(lists, { from: ms(22, 0) }));
    const flags = Object.fromEntries(rows.map((r) => [r.key, [r.asleepBefore, r.asleepAfter]]));
    // The night began before the first row shown.
    expect(flags["sleep-5-end"]).toEqual([true, false]);
    expect(flags["feeding-1"]).toEqual([false, false]);
    expect(flags["sleep-6-start"]).toEqual([false, true]);
    expect(flags["sleep-6-end"]).toEqual([true, false]);
  });

  it("stays asleep after a sleep timer that is still running", () => {
    const rows = markSleep(buildRows({ changes: lists.changes }, { timers: [{ id: 4, kind: "sleep", start: at(22, 6) }] }));
    expect(rows.map((r) => [r.key, r.asleepAfter])).toEqual([["timer-4", true], ["diaper-3", true]]);
  });
});

describe("timerElapsed", () => {
  it("counts from the start, leaving out pauses", () => {
    const timer = { start: at(22, 13), pauses: [{ start: at(22, 13, 10), end: at(22, 13, 15) }] };
    expect(timerElapsed(timer, ms(22, 13, 30))).toBe(25 * 60);
    expect(timerElapsed({ start: at(22, 13) }, ms(22, 13, 0) + 42500)).toBe(42);
  });

  it("stands still while paused, and never goes below zero", () => {
    const timer = { start: at(22, 13), pauses: [{ start: at(22, 13, 20), end: null }] };
    expect(timerElapsed(timer, ms(22, 14))).toBe(20 * 60);
    expect(timerElapsed({ start: at(22, 13) }, ms(22, 12))).toBe(0);
    expect(timerElapsed({ start: "nonsense" }, ms(22, 12))).toBe(0);
  });
});

describe("nudged", () => {
  const now = ms(22, 12);
  const sleep = { start: at(22, 9), end: at(22, 10) };

  it("moves a moment, but not into the future", () => {
    expect(nudged({ kind: "diaper", entry: { time: at(22, 11) } }, -5, now)).toEqual({ time: ms(22, 10, 55) });
    expect(nudged({ kind: "diaper", entry: { time: at(22, 11, 58) } }, 5, now)).toBeNull();
    expect(nudged({ kind: "note", entry: {} }, -5, now)).toBeNull();
  });

  it("moves a feed whole, keeping its length", () => {
    const feed = { start: at(22, 11), end: at(22, 11, 20) };
    expect(nudged({ kind: "feeding", entry: feed }, -5, now)).toEqual({ start: ms(22, 10, 55), end: ms(22, 11, 15) });
    expect(nudged({ kind: "feeding", entry: { start: at(22, 11, 30), end: at(22, 11, 58) } }, 5, now)).toBeNull();
    expect(nudged({ kind: "tummy", entry: { start: at(22, 11) } }, 5, now)).toEqual({ start: ms(22, 11, 5) });
  });

  it("moves one end of a sleep and keeps the two in order", () => {
    expect(nudged({ kind: "sleep", part: "end", entry: sleep }, 5, now)).toEqual({ end: ms(22, 10, 5) });
    expect(nudged({ kind: "sleep", part: "start", entry: sleep }, -5, now)).toEqual({ start: ms(22, 8, 55) });
    const short = { start: at(22, 9), end: at(22, 9, 5) };
    expect(nudged({ kind: "sleep", part: "end", entry: short }, -5, now)).toBeNull();
    expect(nudged({ kind: "sleep", part: "start", entry: short }, 5, now)).toBeNull();
    expect(nudged({ kind: "sleep", part: "end", entry: { start: at(22, 11), end: at(22, 11, 58) } }, 5, now)).toBeNull();
  });

  it("moves the start of a running timer", () => {
    const row = { kind: "sleep", part: "start", live: true, timer: { id: 4, start: at(22, 11, 50) } };
    expect(nudged(row, -5, now)).toEqual({ start: ms(22, 11, 45) });
    expect(nudged(row, 15, now)).toBeNull();
  });
});

describe("describeRow", () => {
  const row = (kind, entry, extra = {}) => ({ kind, entry, ...extra });

  it("words feeds by how they were given", () => {
    expect(say(row("feeding", lists.feedings[0]))).toEqual({ title: "Bottle · 120 mL", detail: "Breast Milk" });
    expect(say(row("feeding", lists.feedings[1]))).toEqual({ title: "Left Breast · 14m", detail: null });
    expect(say(row("feeding", { type: "formula", method: "bottle" }))).toEqual({ title: "Bottle", detail: "Formula" });
    expect(say(row("feeding", { type: "solid food", method: "self fed" }))).toEqual({ title: "Solid Food", detail: "Self Fed" });
    expect(say(row("feeding", null, { live: true }))).toEqual({ title: "Feeding" });
  });

  it("words a sleep at both ends, net of pauses", () => {
    expect(say(row("sleep", lists.sleeps[1], { part: "start" }))).toEqual({ title: "Fell asleep" });
    expect(say(row("sleep", lists.sleeps[1], { part: "end" }))).toEqual({ title: "Woke up", detail: "slept 1h 10m · Nap" });
    expect(say(row("sleep", lists.sleeps[0], { part: "end" })).detail).toBe("slept 10h 50m · Night sleep");
    expect(sleepLength({ ...lists.sleeps[1], paused_seconds: 600 })).toBe("1h");
    expect(sleepLength({ start: at(22, 9), end: at(22, 9) })).toBeNull();
  });

  it("words the rest", () => {
    expect(say(row("diaper", { wet: true, solid: true })).title).toBe("Diaper · Wet + solid");
    expect(say(row("diaper", { wet: false, solid: true })).title).toBe("Diaper · Solid");
    expect(say(row("tummy", { start: at(22, 9), end: at(22, 9, 6) })).title).toBe("Tummy Time · 6m");
    expect(say(row("pumping", { amount: 90 })).title).toBe("Pumping · 90 mL");
    expect(say(row("temp", { temperature: 37.2 })).title).toBe("Temp · 37.2 °C");
    expect(say(row("medication", { name: "Vitamin D", dosage: 1, dosage_unit: "drop" }))).toEqual({ title: "Vitamin D", detail: "1 drop" });
    expect(say(row("note", { note: "Rolled over" })).title).toBe("Rolled over");
    expect(say(row("weight", { weight: 6.2 })).title).toBe("Weight · 6.2 kg");
    expect(say(row("milestone", { title: "First smile" })).title).toBe("First smile");
  });
});
