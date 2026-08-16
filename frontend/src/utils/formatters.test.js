import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  parseDuration,
  formatDuration,
  formatHoursMinutes,
  avgFeedingGap,
  avgBreastDuration,
  stashOutflow,
  toFeedingTimeline,
  overlapHours,
  getAge,
  timeAgo,
  elapsedSince,
  mostRecentAt,
  lastSeenLabel,
  dailyFeedingCountsByType,
} from "./formatters";

describe("formatElapsed", () => {
  it("formats sub-hour durations as MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5)).toBe("00:05");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(599)).toBe("09:59");
  });

  it("formats hour-plus durations as H:MM:SS", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3661)).toBe("1:01:01");
    expect(formatElapsed(36000)).toBe("10:00:00");
  });
});

describe("parseDuration", () => {
  it("parses HH:MM:SS into fractional hours", () => {
    expect(parseDuration("01:30:00")).toBeCloseTo(1.5, 5);
    expect(parseDuration("02:15:00")).toBeCloseTo(2.25, 5);
  });

  it("parses MM:SS as minutes:seconds past the hour marker", () => {
    expect(parseDuration("30:00")).toBeCloseTo(30, 5);
  });

  it("returns 0 for empty/undefined", () => {
    expect(parseDuration("")).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("shows minutes under an hour and decimal hours above", () => {
    expect(formatDuration("00:30:00")).toBe("30m");
    expect(formatDuration("01:30:00")).toBe("1.5h");
  });

  it("renders an em dash for missing duration", () => {
    expect(formatDuration("")).toBe("—");
  });
});

describe("overlapHours", () => {
  const H = 3600000;
  const winStart = Date.UTC(2026, 6, 7, 0, 0, 0); // Jul 7 00:00 UTC
  const winEnd = winStart + 24 * H;

  it("counts an entry fully inside the window", () => {
    const entry = {
      start: new Date(winStart + 2 * H).toISOString(),
      end: new Date(winStart + 5 * H).toISOString(),
    };
    expect(overlapHours(entry, winStart, winEnd)).toBeCloseTo(3, 5);
  });

  it("clips an entry that starts before the window (overnight sleep)", () => {
    const entry = {
      start: new Date(winStart - 2 * H).toISOString(), // started prev day
      end: new Date(winStart + 1 * H).toISOString(), // ends 1h into window
    };
    expect(overlapHours(entry, winStart, winEnd)).toBeCloseTo(1, 5);
  });

  it("clips an entry that ends after the window", () => {
    const entry = {
      start: new Date(winEnd - 1 * H).toISOString(),
      end: new Date(winEnd + 3 * H).toISOString(),
    };
    expect(overlapHours(entry, winStart, winEnd)).toBeCloseTo(1, 5);
  });

  it("returns 0 for an entry entirely outside the window", () => {
    const entry = {
      start: new Date(winEnd + 1 * H).toISOString(),
      end: new Date(winEnd + 2 * H).toISOString(),
    };
    expect(overlapHours(entry, winStart, winEnd)).toBe(0);
  });

  it("returns 0 when start is missing", () => {
    expect(overlapHours({}, winStart, winEnd)).toBe(0);
    expect(overlapHours(null, winStart, winEnd)).toBe(0);
  });
});

describe("getAge", () => {
  it("reports days for newborns under a month", () => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    expect(getAge(d.toISOString())).toMatch(/days$/);
  });

  it("reports years for older children", () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    expect(getAge(d.toISOString())).toMatch(/^3y/);
  });
});

function relativeDateISO(daysAgo, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function relativeDateLabel(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

describe("dailyFeedingCountsByType", () => {
  it("returns zero counts for empty entries", () => {
    const result = dailyFeedingCountsByType([], 7);
    expect(result.length).toBe(7);
    result.forEach((d) => {
      expect(d["breast milk"]).toBe(0);
      expect(d["formula"]).toBe(0);
      expect(d["solid food"]).toBe(0);
      expect(d["fortified breast milk"]).toBe(0);
      expect(d.other).toBe(0);
    });
  });

  it("counts feedings per day grouped by type", () => {
    const entries = [
      { start: relativeDateISO(2), type: "breast milk" },
      { start: relativeDateISO(2, 14), type: "breast milk" },
      { start: relativeDateISO(2, 18), type: "formula" },
      { start: relativeDateISO(1), type: "breast milk" },
      { start: relativeDateISO(0), type: "solid food" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);

    const label2daysAgo = relativeDateLabel(2);
    const label1dayAgo = relativeDateLabel(1);
    const labelToday = relativeDateLabel(0);

    const d2 = result.find((d) => d.date === label2daysAgo);
    const d1 = result.find((d) => d.date === label1dayAgo);
    const d0 = result.find((d) => d.date === labelToday);
    expect(d2["breast milk"]).toBe(2);
    expect(d2["formula"]).toBe(1);
    expect(d1["breast milk"]).toBe(1);
    expect(d0["solid food"]).toBe(1);
  });

  it("handles unknown types by grouping into 'other'", () => {
    const entries = [
      { start: relativeDateISO(3), type: "unknown type" },
      { start: relativeDateISO(2), type: "breast milk" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);

    const d3 = result.find((d) => d.date === relativeDateLabel(3));
    const d2 = result.find((d) => d.date === relativeDateLabel(2));
    expect(d3.other).toBe(1);
    expect(d2["breast milk"]).toBe(1);
  });

  it("trims leading zero-only days", () => {
    const entries = [
      { start: relativeDateISO(5), type: "breast milk" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);
    // First non-zero day should be 5 days ago, not earlier
    const firstEntry = result[0];
    expect(firstEntry.date).toBe(relativeDateLabel(5));
    expect(firstEntry["breast milk"]).toBe(1);
    // Ensure earlier days are not present
    expect(result[0].date).not.toBe(relativeDateLabel(4));
  });

  it("supports fortified breast milk type", () => {
    const entries = [
      { start: relativeDateISO(1), type: "fortified breast milk" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);

    const d1 = result.find((d) => d.date === relativeDateLabel(1));
    expect(d1["fortified breast milk"]).toBe(1);
  });

  it("trims to exactly the days from the first entry through today", () => {
    const entries = [
      { start: relativeDateISO(15), type: "breast milk" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);
    // 15 days ago through today inclusive = 16 days
    expect(result.length).toBe(16);
    expect(result[0].date).toBe(relativeDateLabel(15));
    expect(result[result.length - 1].date).toBe(relativeDateLabel(0));
  });

  it("handles entries with no type field by grouping into 'other'", () => {
    const entries = [
      { start: relativeDateISO(1) },
    ];
    const result = dailyFeedingCountsByType(entries, 30);

    const d1 = result.find((d) => d.date === relativeDateLabel(1));
    expect(d1.other).toBe(1);
  });
});

describe("formatHoursMinutes", () => {
  it("renders hours and minutes", () => {
    expect(formatHoursMinutes(4.65)).toBe("4h 39m");
    expect(formatHoursMinutes(0.25)).toBe("15m");
    expect(formatHoursMinutes(2)).toBe("2h");
  });

  it("returns a dash for missing or non-positive values", () => {
    expect(formatHoursMinutes(0)).toBe("—");
    expect(formatHoursMinutes(-1)).toBe("—");
    expect(formatHoursMinutes(null)).toBe("—");
    expect(formatHoursMinutes(undefined)).toBe("—");
    expect(formatHoursMinutes(NaN)).toBe("—");
  });
});

describe("avgFeedingGap", () => {
  const at = (hoursFromEpoch) =>
    new Date(Date.UTC(2026, 0, 1) + hoursFromEpoch * 3600000).toISOString();

  it("averages the spacing between consecutive feedings", () => {
    // Starts at 0h, 3h, 8h → gaps of 3h and 5h → mean 4h
    const feedings = [{ start: at(0) }, { start: at(3) }, { start: at(8) }];
    expect(avgFeedingGap(feedings)).toBeCloseTo(4, 6);
  });

  it("does not depend on input ordering", () => {
    const ascending = [{ start: at(0) }, { start: at(3) }, { start: at(8) }];
    const descending = [{ start: at(8) }, { start: at(3) }, { start: at(0) }];
    expect(avgFeedingGap(descending)).toBeCloseTo(avgFeedingGap(ascending), 6);
  });

  it("drops gaps of 24h or more as holes in the log", () => {
    // Without the guard the 100h hole would drag the mean from 3h to ~34h
    const feedings = [
      { start: at(0) },
      { start: at(3) },
      { start: at(6) },
      { start: at(106) },
    ];
    expect(avgFeedingGap(feedings)).toBeCloseTo(3, 6);
  });

  it("returns null when there is nothing to compare", () => {
    expect(avgFeedingGap([])).toBeNull();
    expect(avgFeedingGap([{ start: at(0) }])).toBeNull();
    // Two feeds separated only by a logging hole leave no usable gap
    expect(avgFeedingGap([{ start: at(0) }, { start: at(48) }])).toBeNull();
  });

  it("ignores entries with an unparseable start", () => {
    const feedings = [{ start: at(0) }, { start: "not a date" }, { start: at(2) }];
    expect(avgFeedingGap(feedings)).toBeCloseTo(2, 6);
  });
});

describe("avgBreastDuration", () => {
  it("averages nursing sessions only, ignoring bottle feeds", () => {
    const feedings = [
      { method: "left breast", duration: "00:20:00" },
      { method: "both breasts", duration: "00:10:00" },
      // A long bottle feed that would skew the mean if it were counted
      { method: "bottle", duration: "02:00:00" },
    ];
    expect(avgBreastDuration(feedings)).toBeCloseTo(0.25, 6); // 15m
  });

  it("skips breastfeeds with no usable duration", () => {
    const feedings = [
      { method: "right breast", duration: "00:30:00" },
      { method: "right breast", duration: null },
      { method: "right breast", duration: "00:00:00" },
    ];
    expect(avgBreastDuration(feedings)).toBeCloseTo(0.5, 6);
  });

  it("returns null when no breastfeed has a duration", () => {
    expect(avgBreastDuration([])).toBeNull();
    expect(avgBreastDuration([{ method: "bottle", duration: "00:20:00" }])).toBeNull();
    expect(avgBreastDuration([{ method: "left breast" }])).toBeNull();
  });
});

// Mirrors TestMilkStockArithmetic in internal/handlers/milk_waste_test.go —
// the server sums the headline balance and this filter drives the chart beside
// it, so the two definitions of "came out of the stash" have to agree.
// timeAgo and getAge are pure functions used outside React, so they take `t`
// as an optional argument. Without it they must still produce English rather
// than raw keys, and with it they must route every string through it — a
// half-translated relative time is the bug this guards against.
describe("timeAgo / getAge translation", () => {
  const spanish = (key, params = {}) => {
    const dict = {
      "time.justNow": "ahora mismo",
      "time.ago": "hace {{value}}",
      "age.monthsDays": "{{mo}}m {{d}}d",
    };
    let text = dict[key] || key;
    for (const [k, v] of Object.entries(params)) text = text.replace(`{{${k}}}`, v);
    return text;
  };

  it("falls back to English with no t", () => {
    expect(timeAgo(new Date())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 5 * 60000))).toBe("5m ago");
    expect(timeAgo(new Date(Date.now() - 26 * 3600000))).toBe("1d 2h ago");
  });

  it("routes through t when given one", () => {
    expect(timeAgo(new Date(), spanish)).toBe("ahora mismo");
    // Word order is the point: a `${value} ago` template could never produce this
    expect(timeAgo(new Date(Date.now() - 5 * 60000), spanish)).toBe("hace 5m");
  });

  it("translates the age label too", () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    expect(getAge(threeMonthsAgo, spanish)).toMatch(/^3m \d+d$/);
  });
});

describe("stashOutflow", () => {
  const feedings = [
    { id: 1, type: "breast milk", method: "bottle", amount: 50 },
    { id: 2, type: "fortified breast milk", method: "bottle", amount: 20 },
    { id: 3, type: "breast milk", method: "left breast", amount: 90 },
    { id: 4, type: "formula", method: "bottle", amount: 60 },
    { id: 5, type: "solid food", method: "self fed" },
  ];

  it("keeps only bottles of expressed milk", () => {
    expect(stashOutflow(feedings).map((f) => f.id)).toEqual([1, 2]);
  });

  it("excludes nursing, which never touches the stash", () => {
    expect(stashOutflow(feedings).some((f) => f.method === "left breast")).toBe(false);
  });

  it("excludes formula, which never came from it", () => {
    expect(stashOutflow(feedings).some((f) => f.type === "formula")).toBe(false);
  });

  it("handles an empty set", () => {
    expect(stashOutflow([])).toEqual([]);
  });
});

describe("toFeedingTimeline", () => {
  it("appends the session length to breastfeeds", () => {
    const [row] = toFeedingTimeline([
      { start: "2026-01-01T08:00:00Z", end: "2026-01-01T08:20:00Z", method: "left breast", duration: "00:20:00" },
    ]);
    // The DB enum "left breast" is rendered through its i18n label
    expect(row.label).toBe("Left Breast · 20m");
  });

  it("leaves bottle feeds showing their amount alone", () => {
    const [row] = toFeedingTimeline(
      [{ start: "2026-01-01T08:00:00Z", method: "bottle", amount: 120, duration: "00:15:00" }],
      "mL",
    );
    expect(row.label).toBe("120 mL Bottle");
  });

  it("omits the duration when a breastfeed has none", () => {
    const [row] = toFeedingTimeline([
      { start: "2026-01-01T08:00:00Z", method: "both breasts" },
    ]);
    expect(row.label).toBe("Both Breasts");
  });
});

describe("elapsedSince", () => {
  const agoMinutes = (m) => new Date(Date.now() - m * 60000);

  it("returns null under a minute, so callers can say 'just now'", () => {
    expect(elapsedSince(new Date())).toBeNull();
    expect(elapsedSince(agoMinutes(0.5))).toBeNull();
  });

  it("renders minutes, hours and days", () => {
    expect(elapsedSince(agoMinutes(5))).toBe("5m");
    expect(elapsedSince(agoMinutes(60))).toBe("1h");
    expect(elapsedSince(agoMinutes(70))).toBe("1h 10m");
    expect(elapsedSince(agoMinutes(60 * 24))).toBe("1d");
    expect(elapsedSince(agoMinutes(60 * 26))).toBe("1d 2h");
  });

  it("returns null for an unparseable date", () => {
    expect(elapsedSince("not a date")).toBeNull();
  });
});

// The Overview stat cards report today's totals, so just after midnight they
// read "0 feedings today" and the last actual feed — 23:40, twenty minutes
// earlier — was invisible without paging back a day. These cards now carry a
// "last seen" line computed from the seven-day sets instead.
describe("mostRecentAt", () => {
  const at = (isoOffsetHours) =>
    new Date(Date.now() - isoOffsetHours * 3600000).toISOString();

  it("returns null for an empty set", () => {
    expect(mostRecentAt([])).toBeNull();
    expect(mostRecentAt()).toBeNull();
  });

  it("measures a duration entry from when it ended, not when it began", () => {
    // A 40-minute feed that finished 5 minutes ago
    const entry = { start: at(0.75), end: at(0.083) };
    const ms = mostRecentAt([entry]);
    const minutesAgo = (Date.now() - ms) / 60000;
    expect(minutesAgo).toBeLessThan(10);
  });

  it("uses `time` for point entries like diaper changes", () => {
    const ms = mostRecentAt([{ time: at(2) }]);
    const hoursAgo = (Date.now() - ms) / 3600000;
    expect(hoursAgo).toBeCloseTo(2, 1);
  });

  it("finds the newest even when the list is not sorted by end", () => {
    const entries = [
      { start: at(9), end: at(8) },
      { start: at(2), end: at(1) }, // newest end
      { start: at(5), end: at(4) },
    ];
    const hoursAgo = (Date.now() - mostRecentAt(entries)) / 3600000;
    expect(hoursAgo).toBeCloseTo(1, 1);
  });

  // The case that prompted all this.
  it("still finds last night's feed just after midnight", () => {
    const now = new Date();
    const lastNight = new Date(now);
    lastNight.setDate(lastNight.getDate() - 1);
    lastNight.setHours(23, 40, 0, 0);

    // "Today" is empty; the week's data still holds yesterday evening.
    const todayOnly = [];
    const weekly = [{ start: lastNight.toISOString(), end: lastNight.toISOString() }];

    expect(mostRecentAt(todayOnly)).toBeNull();
    expect(mostRecentAt(weekly)).toBe(lastNight.getTime());
  });

  it("ignores entries with unusable timestamps", () => {
    const good = at(1);
    expect(mostRecentAt([{ start: "nonsense" }, { time: good }])).toBe(
      new Date(good).getTime(),
    );
  });
});

describe("lastSeenLabel", () => {
  it("phrases the span for the card footer", () => {
    expect(lastSeenLabel(new Date(Date.now() - 5 * 60000))).toBe("Last: 5m ago");
  });

  it("falls back to 'just now' under a minute", () => {
    expect(lastSeenLabel(new Date())).toBe("just now");
  });

  it("routes through t, so word order follows the language", () => {
    const spanish = (key, params = {}) => {
      const dict = { "overview.lastEntry": "Hace {{value}}", "time.justNow": "ahora mismo" };
      let text = dict[key] || key;
      for (const [k, v] of Object.entries(params)) text = text.replace(`{{${k}}}`, v);
      return text;
    };
    expect(lastSeenLabel(new Date(Date.now() - 5 * 60000), spanish)).toBe("Hace 5m");
    expect(lastSeenLabel(new Date(), spanish)).toBe("ahora mismo");
  });
});
