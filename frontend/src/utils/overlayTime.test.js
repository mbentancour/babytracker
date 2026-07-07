import { describe, it, expect } from "vitest";
import { agoAnchor, formatAwake } from "./overlayTime";

describe("agoAnchor", () => {
  it("uses the end time for a completed feeding/sleep", () => {
    expect(agoAnchor({ start: "2026-07-07T10:00:00Z", end: "2026-07-07T10:30:00Z" })).toBe("2026-07-07T10:30:00Z");
  });
  it("falls back to start when end is missing (ongoing entry)", () => {
    expect(agoAnchor({ start: "2026-07-07T10:00:00Z" })).toBe("2026-07-07T10:00:00Z");
  });
  it("falls back to start when end is the zero/ancient time (< start)", () => {
    expect(agoAnchor({ start: "2026-07-07T10:00:00Z", end: "0001-01-01T00:00:00Z" })).toBe("2026-07-07T10:00:00Z");
  });
  it("uses time for a point-in-time entry (diaper)", () => {
    expect(agoAnchor({ time: "2026-07-07T10:00:00Z" })).toBe("2026-07-07T10:00:00Z");
  });
});

describe("formatAwake", () => {
  const M = 60000;
  it("renders minutes only under an hour", () => { expect(formatAwake(45 * M)).toBe("45m"); });
  it("renders hours and minutes compactly", () => { expect(formatAwake(90 * M)).toBe("1h30m"); });
  it("drops minutes when zero", () => { expect(formatAwake(120 * M)).toBe("2h"); });
  it("renders days and hours", () => { expect(formatAwake(26 * 60 * M)).toBe("1d2h"); });
  it("floors sub-minute to <1m", () => { expect(formatAwake(30000)).toBe("<1m"); });
});
