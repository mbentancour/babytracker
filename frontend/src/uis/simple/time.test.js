import { describe, it, expect } from "vitest";
import { toUTC, quickSpan, clock, lastClock, isNapSleep } from "./time";

describe("simple UI time helpers", () => {
  it("formats a date as the API's naive UTC string", () => {
    expect(toUTC(new Date(Date.UTC(2026, 9, 22, 8, 5, 9)))).toBe("2026-10-22T08:05:09");
  });

  it("records a quick feed as the quarter of an hour before the time given", () => {
    expect(quickSpan(new Date(Date.UTC(2026, 9, 22, 8, 5, 9)))).toEqual({ start: "2026-10-22T07:50:09", end: "2026-10-22T08:05:09" });
    expect(quickSpan(new Date(Date.UTC(2026, 9, 22, 0, 5)))).toEqual({ start: "2026-10-21T23:50:00", end: "2026-10-22T00:05:00" });
  });

  it("formats a clock reading for a time input", () => {
    expect(clock(new Date(2026, 9, 22, 7, 5))).toBe("07:05");
  });

  it("reads a clock time as today when it has already passed", () => {
    const now = new Date(2026, 9, 22, 14, 30);
    expect(lastClock("13:10", now)).toEqual(new Date(2026, 9, 22, 13, 10));
    expect(lastClock("14:30", now)).toEqual(new Date(2026, 9, 22, 14, 30));
  });

  it("reads a clock time still to come today as yesterday", () => {
    const now = new Date(2026, 9, 22, 0, 20);
    expect(lastClock("23:40", now)).toEqual(new Date(2026, 9, 21, 23, 40));
  });

  it("returns null for an empty or malformed time", () => {
    const now = new Date(2026, 9, 22, 14, 30);
    expect(lastClock("", now)).toBeNull();
    expect(lastClock("soon", now)).toBeNull();
  });

  it("calls a short daytime sleep a nap and anything else night sleep", () => {
    const at = (h, m = 0, d = 22) => new Date(2026, 9, d, h, m);
    expect(isNapSleep(at(13), at(14, 30))).toBe(true);
    expect(isNapSleep(at(7), at(7, 20))).toBe(true);
    expect(isNapSleep(at(19), at(20))).toBe(false);
    expect(isNapSleep(at(6, 59), at(7, 30))).toBe(false);
    expect(isNapSleep(at(8), at(12))).toBe(false);
    expect(isNapSleep(at(21), at(6, 0, 23))).toBe(false);
  });
});
