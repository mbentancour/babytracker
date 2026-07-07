import { describe, it, expect } from "vitest";
import {
  buildWHOCurves,
  ageInMonths,
  mapMeasurementsToAge,
  METRIC_TABLES,
} from "./whoPercentiles";

describe("ageInMonths", () => {
  it("computes ~0 at birth", () => {
    expect(ageInMonths("2026-01-01", "2026-01-01")).toBeCloseTo(0, 5);
  });

  it("computes ~12 months after a year", () => {
    // 365 / 30.4375 ≈ 11.99 months
    expect(ageInMonths("2025-01-01", "2026-01-01")).toBeCloseTo(11.99, 1);
  });

  it("accepts Date objects as well as strings", () => {
    const b = new Date("2026-01-01");
    const m = new Date("2026-02-01");
    expect(ageInMonths(b, m)).toBeCloseTo(31 / 30.4375, 5);
  });
});

describe("buildWHOCurves", () => {
  it("returns empty for unknown metric or missing sex", () => {
    expect(buildWHOCurves("bogus", "male", 0, 24)).toEqual([]);
    expect(buildWHOCurves("weight", "", 0, 24)).toEqual([]);
  });

  it("produces monotonically increasing percentiles at each age", () => {
    const curves = buildWHOCurves("weight", "male", 0, 24);
    expect(curves.length).toBeGreaterThan(0);
    for (const point of curves) {
      // p3 < p15 < p50 < p85 < p97 must always hold — a broken LMS/z mapping
      // would cross these.
      expect(point.p3).toBeLessThan(point.p15);
      expect(point.p15).toBeLessThan(point.p50);
      expect(point.p50).toBeLessThan(point.p85);
      expect(point.p85).toBeLessThan(point.p97);
    }
  });

  it("p50 equals the table's M value at an exact table age", () => {
    // At z=0 the LMS formula collapses to M, so the median curve must equal
    // the raw M parameter at any age that's a table row.
    const table = METRIC_TABLES.weight.boys;
    const [ageMonths, , M] = table[6]; // some interior row
    const curves = buildWHOCurves("weight", "male", ageMonths, ageMonths, 1);
    const pt = curves.find((p) => p.ageMonths === ageMonths);
    expect(pt).toBeDefined();
    expect(pt.p50).toBeCloseTo(M, 2);
  });

  it("gives boys a higher median weight than girls at 12 months", () => {
    const boys = buildWHOCurves("weight", "male", 12, 12);
    const girls = buildWHOCurves("weight", "female", 12, 12);
    expect(boys[0].p50).toBeGreaterThan(girls[0].p50);
  });
});

describe("mapMeasurementsToAge", () => {
  it("returns empty without a birth date", () => {
    expect(mapMeasurementsToAge([{ date: "2026-01-01", weight: 5 }], "weight", null)).toEqual([]);
  });

  it("drops entries missing the value or date, and out-of-range ages", () => {
    const birth = "2026-01-01";
    const entries = [
      { date: "2026-02-01", weight: 5 }, // ~1mo — kept
      { date: "2026-02-01", weight: null }, // no value — dropped
      { weight: 6 }, // no date — dropped
      { date: "2035-01-01", weight: 20 }, // >60mo — dropped
    ];
    const out = mapMeasurementsToAge(entries, "weight", birth);
    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(5);
    expect(out[0].ageMonths).toBeGreaterThan(0);
    expect(out[0].ageMonths).toBeLessThan(2);
  });
});
