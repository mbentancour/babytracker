import { describe, it, expect } from "vitest";
import { median, feedRhythm, awakeWindow, lastWoke, sleepBetween, byNow, countBetween, ribbonMarks, usualFeeds, nextSleepAt } from "./insights";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m);
const iso = (d, h, m = 0) => at(d, h, m).toISOString();
const HOUR = 3600000;

describe("median", () => {
  it("handles odd, even and empty sets", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("feedRhythm", () => {
  const every3h = [6, 9, 12, 15, 18].map((h) => ({ start: iso(22, h) }));

  it("estimates the next feed from the usual gap", () => {
    const r = feedRhythm(every3h);
    expect(r.gapMs).toBe(3 * HOUR);
    expect(r.last).toBe(at(22, 18).getTime());
    expect(r.nextAt).toBe(at(22, 21).getTime());
  });

  it("is not thrown off by one long night stretch", () => {
    const withNight = [...[21, 0].map((h, i) => ({ start: iso(21 + i, h) })), ...every3h];
    // gaps: 3h (21->00), 6h (00->06), 3h x4 -> median 3h
    expect(feedRhythm(withNight).gapMs).toBe(3 * HOUR);
  });

  it("gives no estimate from too few feeds, but still knows the last one", () => {
    const r = feedRhythm(every3h.slice(0, 3));
    expect(r.nextAt).toBeNull();
    expect(r.last).toBe(at(22, 12).getTime());
    expect(feedRhythm([])).toBeNull();
  });

  it("ignores holes in the log", () => {
    const holed = [{ start: iso(18, 8) }, ...every3h];
    expect(feedRhythm(holed).gapMs).toBe(3 * HOUR);
  });
});

describe("awakeWindow and lastWoke", () => {
  const sleeps = [
    { start: iso(22, 9), end: iso(22, 10) },
    { start: iso(22, 12), end: iso(22, 13, 30) },
    { start: iso(22, 15, 30), end: iso(22, 16) },
    { start: iso(22, 18), end: iso(22, 18, 40) },
  ];

  it("finds the usual stretch awake between sleeps", () => {
    // awake: 2h, 2h, 2h
    expect(awakeWindow(sleeps)).toBe(2 * HOUR);
  });

  it("needs three stretches", () => {
    expect(awakeWindow(sleeps.slice(0, 3))).toBeNull();
  });

  it("knows when the baby last woke", () => {
    expect(lastWoke(sleeps)).toBe(at(22, 18, 40).getTime());
    expect(lastWoke([])).toBeNull();
    expect(lastWoke([{ start: iso(22, 9) }])).toBeNull();
  });
});

describe("sleepBetween", () => {
  const day = [at(22, 0).getTime(), at(23, 0).getTime()];

  it("counts only the part inside the window", () => {
    const overnight = [{ start: iso(21, 20), end: iso(22, 6) }];
    expect(sleepBetween(overnight, ...day)).toBe(6 * HOUR);
  });

  it("counts a sleep still going up to the end of the window", () => {
    expect(sleepBetween([{ start: iso(22, 13) }], at(22, 0).getTime(), at(22, 14).getTime())).toBe(HOUR);
  });

  it("leaves out paused time", () => {
    const paused = [{ start: iso(22, 10), end: iso(22, 12), paused_seconds: 1800 }];
    expect(sleepBetween(paused, ...day)).toBe(1.5 * HOUR);
  });
});

describe("byNow", () => {
  const feeds = [
    // today (22nd): two by 14:00
    { start: iso(22, 7) }, { start: iso(22, 11) },
    // 21st: three by 14:00, one after
    { start: iso(21, 6) }, { start: iso(21, 10) }, { start: iso(21, 13) }, { start: iso(21, 19) },
    // 20th: one by 14:00, two after
    { start: iso(20, 9) }, { start: iso(20, 16) }, { start: iso(20, 20) },
  ];
  const count = countBetween(feeds, "start");

  it("compares today so far with the same stretch of earlier days", () => {
    const r = byNow(count, (a, b) => count(a, b) > 0, at(22, 14).getTime());
    expect(r.today).toBe(2);
    expect(r.usual).toBe(2); // (3 + 1) / 2
  });

  it("skips days with no tracking instead of averaging in zeros", () => {
    const r = byNow(count, (a, b) => count(a, b) > 0, at(22, 14).getTime(), 6);
    // The 16th-19th have nothing and are left out; still only two days.
    expect(r.usual).toBe(2);
  });

  it("has no usual figure with fewer than two earlier days", () => {
    const onlyYesterday = feeds.slice(0, 6);
    const c = countBetween(onlyYesterday, "start");
    expect(byNow(c, (a, b) => c(a, b) > 0, at(22, 14).getTime()).usual).toBeNull();
  });
});

describe("ribbonMarks", () => {
  const now = at(22, 14).getTime();

  it("places sleeps and events on a 0..1 scale of the last 24 hours", () => {
    const marks = ribbonMarks(
      {
        sleeps: [{ start: iso(22, 2), end: iso(22, 8), nap: false }],
        feedings: [{ id: 1, start: iso(22, 8) }],
        changes: [{ id: 2, time: iso(22, 11) }],
      },
      now
    );
    expect(marks.sleep).toEqual([{ from: 0.5, to: 0.75, nap: false }]);
    expect(marks.feeds[0].x).toBe(0.75);
    expect(marks.diapers[0].x).toBe(0.875);
  });

  it("clips a sleep that began before the window and drops what is outside it", () => {
    const marks = ribbonMarks(
      {
        sleeps: [{ start: iso(21, 12), end: iso(21, 16) }, { start: iso(20, 1), end: iso(20, 5) }],
        feedings: [{ start: iso(21, 9) }],
      },
      now
    );
    expect(marks.sleep).toHaveLength(1);
    expect(marks.sleep[0].from).toBe(0);
    expect(marks.sleep[0].to).toBeCloseTo(2 / 24);
    expect(marks.feeds).toHaveLength(0);
  });

  it("runs an ongoing sleep to now", () => {
    const marks = ribbonMarks({ asleepSince: at(22, 13).getTime() }, now);
    expect(marks.sleep).toEqual([{ from: 23 / 24, to: 1, ongoing: true }]);
  });

  it("puts ticks on every third whole hour", () => {
    const { ticks } = ribbonMarks({}, now);
    expect(ticks.map((t) => t.hour)).toEqual([15, 18, 21, 0, 3, 6, 9, 12]);
    expect(ticks[0].x).toBeCloseTo(1 / 24);
  });
});

describe("usualFeeds", () => {
  const feed = (d, h, type, method, amount) => ({ start: iso(d, h), type, method, amount });

  it("offers the kinds fed most, each with its latest amount", () => {
    const feeds = [
      feed(22, 12, "breast milk", "bottle", 130),
      feed(22, 9, "breast milk", "left breast"),
      feed(22, 6, "breast milk", "bottle", 120),
      feed(21, 18, "breast milk", "bottle", 110),
      feed(21, 15, "breast milk", "left breast"),
      feed(21, 12, "solid food", "parent fed"),
    ];
    expect(usualFeeds(feeds)).toEqual([
      { type: "breast milk", method: "bottle", amount: 130 },
      { type: "breast milk", method: "left breast", amount: null },
      { type: "solid food", method: "parent fed", amount: null },
    ]);
  });

  it("breaks ties by what was fed most recently, and respects the limit", () => {
    const feeds = [
      feed(22, 12, "formula", "bottle", 150),
      feed(22, 9, "breast milk", "left breast"),
      feed(22, 6, "breast milk", "right breast"),
    ];
    expect(usualFeeds(feeds, 2).map((f) => f.method)).toEqual(["bottle", "left breast"]);
  });

  it("returns nothing for a baby with no feeds", () => {
    expect(usualFeeds([])).toEqual([]);
  });
});

describe("nextSleepAt", () => {
  it("adds the usual stretch awake to the last wake-up", () => {
    const sleeps = [
      { start: iso(22, 9), end: iso(22, 10) },
      { start: iso(22, 12), end: iso(22, 13) },
      { start: iso(22, 15), end: iso(22, 16) },
      { start: iso(22, 18), end: iso(22, 19) },
    ];
    expect(nextSleepAt(sleeps)).toBe(at(22, 21).getTime());
  });

  it("is null without enough sleeps to know what is usual", () => {
    expect(nextSleepAt([{ start: iso(22, 9), end: iso(22, 10) }])).toBeNull();
  });
});
