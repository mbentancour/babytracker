import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { toLocalDatetime, localInputToUTC } from "./datetime";

// These helpers are timezone-sensitive by design, so pin the zone. Vitest
// respects the TZ env var via the underlying Node runtime; we assert on a
// fixed offset zone (Europe/Madrid: +01:00 winter, +02:00 summer).
describe("localInputToUTC", () => {
  it("returns empty string for empty input", () => {
    expect(localInputToUTC("")).toBe("");
    expect(localInputToUTC(null)).toBe("");
  });

  it("appends seconds and produces a naive UTC string", () => {
    // A UTC-zone process: local == UTC, so the wall clock is unchanged.
    const out = localInputToUTC("2026-07-07T16:00");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // No timezone suffix — the backend parses these as UTC.
    expect(out).not.toMatch(/[Z+]/);
  });

  it("round-trips through toLocalDatetime for the current zone", () => {
    // toLocalDatetime(new Date(utc)) should recover the same local wall clock
    // that localInputToUTC started from.
    const local = "2026-03-15T09:30";
    const utc = localInputToUTC(local); // naive UTC "YYYY-MM-DDTHH:MM:SS"
    const back = toLocalDatetime(new Date(utc + "Z"));
    expect(back).toBe(local);
  });
});

describe("toLocalDatetime", () => {
  it("zero-pads all fields to the datetime-local shape", () => {
    // Construct from explicit local components.
    const d = new Date(2026, 0, 3, 4, 5); // Jan 3 2026 04:05 local
    expect(toLocalDatetime(d)).toBe("2026-01-03T04:05");
  });
});
