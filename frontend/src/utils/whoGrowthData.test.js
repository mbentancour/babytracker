import { describe, it, expect } from "vitest";
import { buildWHOCurves } from "./whoPercentiles";
import {
  WEIGHT_FOR_AGE_BOYS,
  WEIGHT_FOR_AGE_GIRLS,
  HEIGHT_FOR_AGE_BOYS,
  HEIGHT_FOR_AGE_GIRLS,
  HEADCIRC_FOR_AGE_BOYS,
  HEADCIRC_FOR_AGE_GIRLS,
} from "./whoGrowthData";

// [month, L, M, S] copied from the WHO monthly z-score tables (0-5 years):
// wfa_*_0-to-5-years_zscores.xlsx, lhfa_*_zscores.xlsx, hcfa-*-0-5-zscores.xlsx
// https://www.who.int/tools/child-growth-standards/standards
const WHO_ROWS = [
  ["weight-for-age boys", WEIGHT_FOR_AGE_BOYS, [60, -0.1506, 18.3366, 0.13517]],
  ["weight-for-age girls", WEIGHT_FOR_AGE_GIRLS, [36, -0.3201, 13.8503, 0.12919]],
  ["height-for-age boys", HEIGHT_FOR_AGE_BOYS, [18, 1, 82.2587, 0.03279]],
  ["height-for-age girls", HEIGHT_FOR_AGE_GIRLS, [60, 1, 109.4233, 0.04347]],
  ["head-circumference-for-age boys", HEADCIRC_FOR_AGE_BOYS, [12, 1, 46.0661, 0.02789]],
  ["head-circumference-for-age girls", HEADCIRC_FOR_AGE_GIRLS, [6, 1, 42.1995, 0.03087]],
];

describe("WHO LMS reference data", () => {
  it.each(WHO_ROWS)("%s matches the WHO table", (_name, table, expected) => {
    const row = table.find(([month]) => month === expected[0]);
    expect(row).toEqual(expected);
  });

  it("puts the 3rd and 97th head-circumference percentiles for boys at 12 months at 43.65 and 48.48 cm", () => {
    const [point] = buildWHOCurves("headcirc", "male", 12, 12);
    expect(point.p3).toBeCloseTo(43.65, 2);
    expect(point.p97).toBeCloseTo(48.48, 2);
  });
});
