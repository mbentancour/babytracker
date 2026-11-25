import { describe, it, expect } from "vitest";
import {
  mix, nightness, skyAt, skyStops, skyDown, gradient, hourMarks, stars, span, luminance, contrast, inkOn, INK_LIGHT, INK_DARK, SKY_HOLD,
} from "./daylight";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe("sky colours", () => {
  it("mixes two colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#102030", 0.3)).toBe("#102030");
  });

  it("is dark at night and blue at noon, high up and at the horizon", () => {
    expect(skyAt(at(22, 0))).toEqual({ high: "#0b1033", horizon: "#1b2356", strip: "#141c4e" });
    expect(skyAt(at(22, 12))).toEqual({ high: "#1553b8", horizon: "#4c9ae6", strip: "#4897e7" });
    expect(skyAt(at(22, 2)).high).toBe(mix("#0B1033", "#101845", 0.4));
  });

  it("is warm at the horizon when the sun comes up and goes down", () => {
    expect(skyAt(at(22, 7)).horizon).toBe("#ee9a69");
    expect(skyAt(at(22, 19)).horizon).toBe("#e46e5e");
  });

  it("knows night from day, with a ramp at each end", () => {
    expect(nightness(at(22, 3))).toBe(1);
    expect(nightness(at(22, 12))).toBe(0);
    expect(nightness(at(22, 23))).toBe(1);
    expect(nightness(at(22, 6, 45))).toBeGreaterThan(0);
    expect(nightness(at(22, 6, 45))).toBeLessThan(1);
  });
});

// The header is read at a glance, outdoors, at arm's length: whatever is
// written on the sky has to stand out from it. 4.5 to 1 is what WCAG asks of
// small text.
describe("writing on the sky", () => {
  const everyFiveMinutes = Array.from({ length: 288 }, (_, i) => at(22, 0, i * 5));
  const worst = (heights, ink) => Math.min(...everyFiveMinutes.flatMap((ms) => heights.map((y) => {
    const sky = skyDown(skyAt(ms), y);
    return contrast(ink(sky), sky);
  })));

  it("measures lightness and contrast as WCAG does", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#ffffff", "#777777")).toBe(contrast("#777777", "#ffffff"));
  });

  it("keeps the sky its high colour down to where the white text ends", () => {
    const noon = skyAt(at(22, 12));
    expect(skyDown(noon, 0)).toBe(noon.high);
    expect(skyDown(noon, SKY_HOLD)).toBe(noon.high);
    expect(skyDown(noon, 1)).toBe(noon.horizon);
  });

  it("is dark enough for small white text all day, as far down as the header writes in white", () => {
    // Name, labels and figures sit in the top half. The line under a figure
    // ends at 0.57 of the height, 0.62 when it wraps, 0.67 when it wraps twice.
    expect(worst([0, 0.3, SKY_HOLD, 0.57, 0.62, 0.67], () => INK_LIGHT)).toBeGreaterThanOrEqual(4.5);
  });

  it("has an ink that reads on the sky at any hour, lower down where it may be bright", () => {
    // The icons beside the strip, and the hours under it.
    expect(worst([0.74, 0.78, 0.85, 0.92, 1], inkOn)).toBeGreaterThan(4.45);
  });

  it("picks the dark ink on a bright sky and white on a dark one", () => {
    expect(inkOn(skyAt(at(22, 12)).horizon)).toBe(INK_DARK);
    expect(inkOn(skyAt(at(22, 7)).horizon)).toBe(INK_DARK);
    expect(inkOn(skyAt(at(22, 23)).horizon)).toBe(INK_LIGHT);
    expect(inkOn("#808080")).toBe(INK_DARK);
  });
});

describe("skyStops", () => {
  it("covers the strip from end to end, in order", () => {
    const stops = skyStops(at(21, 14), at(22, 14));
    expect(stops[0].pos).toBe(0);
    expect(stops[stops.length - 1].pos).toBe(1);
    const positions = stops.map((s) => s.pos);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("puts midnight and noon where they fall in the window", () => {
    const stops = skyStops(at(21, 14), at(22, 14));
    // Midnight is 10 of 24 hours in; noon 22 of 24.
    expect(stops.some((s) => Math.abs(s.pos - 10 / 24) < 1e-9 && s.strip === "#141C4E")).toBe(true);
    expect(stops.some((s) => Math.abs(s.pos - 22 / 24) < 1e-9 && s.strip === "#4897E7")).toBe(true);
  });

  it("is empty for a window with no length", () => {
    expect(skyStops(at(22, 14), at(22, 14))).toEqual([]);
    expect(gradient([], "strip")).toBe("none");
  });

  it("writes a CSS gradient", () => {
    const css = gradient(skyStops(at(22, 0), at(23, 0)), "strip");
    expect(css.startsWith("linear-gradient(90deg, #141c4e 0.00%")).toBe(true);
    expect(css.endsWith("100.00%)")).toBe(true);
  });
});

describe("hourMarks", () => {
  it("marks every sixth hour, flagging noon and midnight", () => {
    const marks = hourMarks(at(21, 14), at(22, 14));
    expect(marks.map((m) => m.hour)).toEqual([18, 0, 6, 12]);
    expect(marks.map((m) => m.kind)).toEqual(["hour", "midnight", "hour", "noon"]);
    expect(marks[0].pos).toBeCloseTo(4 / 24);
  });

  it("includes an hour that is exactly the start of the window", () => {
    expect(hourMarks(at(22, 0), at(23, 0)).map((m) => m.hour)).toEqual([0, 6, 12, 18, 0]);
  });
});

describe("stars and spans", () => {
  it("scatters the same stars every time", () => {
    expect(stars(12)).toEqual(stars(12));
    expect(stars(12)).toHaveLength(12);
    for (const s of stars(40)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeLessThan(0.7);
    }
  });

  it("places a stretch of time on the strip, clipped to it", () => {
    const [from, to] = [at(22, 0), at(23, 0)];
    expect(span(at(22, 6), at(22, 12), from, to)).toEqual({ left: 0.25, width: 0.25 });
    expect(span(at(21, 20), at(22, 6), from, to)).toEqual({ left: 0, width: 0.25 });
    expect(span(at(21, 20), at(21, 22), from, to)).toBeNull();
  });
});
