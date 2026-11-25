import { describe, it, expect } from "vitest";
import {
  median, feedRhythm, feedStarts, awakeWindow, lastWoke, sleepBetween, byNow, countBetween, amountBetween, usualFeeds, nextSleepAt,
} from "./insights";

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

  // One tap on "Left breast" and one on "Right breast" a quarter of an hour
  // later: two entries, one feed.
  const span = (d, h, m, minutes = 15) => ({ start: iso(d, h, m), end: iso(d, h, m + minutes) });
  const bothSides = [6, 9, 12, 15, 18].flatMap((h) => [span(22, h, 0), span(22, h, 15)]);

  it("takes both sides of one feed as one feed", () => {
    const r = feedRhythm(bothSides);
    expect(r.gapMs).toBe(3 * HOUR);
    // Counted from when the feed began, not from its second side.
    expect(r.last).toBe(at(22, 18).getTime());
    expect(r.nextAt).toBe(at(22, 21).getTime());
    expect(feedStarts(bothSides)).toHaveLength(5);
  });

  it("joins a bottle given to finish a feed, up to half an hour after it", () => {
    // Nursed 09:00-09:20, then a bottle begun at 09:45: the same feed.
    expect(feedStarts([span(22, 9, 0, 20), span(22, 9, 45)])).toEqual([at(22, 9).getTime()]);
    // Begun at 09:55, more than half an hour after the nursing ended: another.
    expect(feedStarts([span(22, 9, 0, 20), span(22, 9, 55)])).toHaveLength(2);
  });

  it("keeps feeds an hour apart as separate feeds", () => {
    const cluster = [17, 18, 19, 20, 21].map((h) => span(22, h, 0));
    expect(feedRhythm(cluster).gapMs).toBe(HOUR);
  });

  it("does not let an entry with a mistyped end swallow the feeds after it", () => {
    const wrongEnd = { start: iso(22, 6), end: iso(23, 6) };
    expect(feedStarts([wrongEnd, ...[9, 12, 15, 18].map((h) => span(22, h, 0))])).toHaveLength(5);
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

describe("amountBetween", () => {
  const feeds = [
    { start: iso(22, 7), amount: 120 },
    { start: iso(22, 10) }, // nursing: no amount
    { start: iso(22, 13), amount: "90" },
    { start: iso(21, 19), amount: 150 },
  ];

  it("adds up what the feeds in the window say was drunk", () => {
    const drunk = amountBetween(feeds, "start");
    expect(drunk(at(22, 0).getTime(), at(23, 0).getTime())).toBe(210);
    expect(drunk(at(22, 0).getTime(), at(22, 12).getTime())).toBe(120);
    expect(drunk(at(20, 0).getTime(), at(21, 0).getTime())).toBe(0);
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
