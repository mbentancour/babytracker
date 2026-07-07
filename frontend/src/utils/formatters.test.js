import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  parseDuration,
  formatDuration,
  overlapHours,
  getAge,
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
