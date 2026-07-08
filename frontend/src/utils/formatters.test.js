import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  parseDuration,
  formatDuration,
  overlapHours,
  getAge,
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

  it("returns all 30 days when there is data", () => {
    const entries = [
      { start: relativeDateISO(15), type: "breast milk" },
    ];
    const result = dailyFeedingCountsByType(entries, 30);
    expect(result.length).toBeLessThanOrEqual(30);
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
