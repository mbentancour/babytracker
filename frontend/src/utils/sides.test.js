import { describe, it, expect } from "vitest";
import {
  sumSides, pumpedSides, nursedSides, pumpingAmounts, pumpingStart, halves, nursingStart, nursingLength, sidesText,
} from "./sides";

const t = (key) => ({ "sides.left": "Left", "sides.right": "Right" })[key] || key;
const at = (h, m = 0) => new Date(2026, 9, 22, h, m).toISOString();

describe("sumSides", () => {
  it("adds the two sides, a missing one counting as nothing", () => {
    expect(sumSides(40, 50)).toBe(90);
    expect(sumSides(null, 60)).toBe(60);
    expect(sumSides("", "")).toBe(0);
    expect(sumSides("1.5", "2")).toBe(3.5);
  });

  it("leaves no decimal dust behind", () => {
    expect(sumSides(0.1, 0.2)).toBe(0.3);
  });
});

describe("pumpedSides", () => {
  it("is null for a session that only has a total", () => {
    expect(pumpedSides({ amount: 90 })).toBeNull();
    expect(pumpedSides({ amount: 90, amount_left: null, amount_right: null })).toBeNull();
    expect(pumpedSides(null)).toBeNull();
  });

  it("gives what each breast gave, also when only one was pumped", () => {
    expect(pumpedSides({ amount: 90, amount_left: 40, amount_right: 50 })).toEqual({ left: 40, right: 50 });
    expect(pumpedSides({ amount: 60, amount_left: null, amount_right: 60 })).toEqual({ left: null, right: 60 });
    expect(pumpedSides({ amount: 60, amount_left: 60, amount_right: 0 })).toEqual({ left: 60, right: 0 });
  });
});

describe("nursedSides", () => {
  it("belongs to a feed on both breasts only", () => {
    expect(nursedSides({ method: "both breasts", left_seconds: 600, right_seconds: 480 })).toEqual({ left: 600, right: 480 });
    expect(nursedSides({ method: "both breasts" })).toBeNull();
    expect(nursedSides({ method: "left breast", left_seconds: 600, right_seconds: 0 })).toBeNull();
    expect(nursedSides(undefined)).toBeNull();
  });
});

describe("pumpingAmounts", () => {
  it("saves a total as the amount", () => {
    expect(pumpingAmounts({ split: false, amount: 90, left: 40, right: 50 })).toEqual({ amount: 90 });
  });

  it("saves the two sides and leaves the adding up to the server", () => {
    expect(pumpingAmounts({ split: true, amount: 10, left: 40, right: 50 })).toEqual({ amount_left: 40, amount_right: 50 });
    expect(pumpingAmounts({ split: true, amount: 10, left: 60, right: 0 })).toEqual({ amount_left: 60, amount_right: 0 });
  });

  it("saves no amount when nothing was measured", () => {
    expect(pumpingAmounts({ split: false, amount: 0, left: 40, right: 50 })).toEqual({});
    expect(pumpingAmounts({ split: true, amount: 90, left: 0, right: 0 })).toEqual({});
  });
});

describe("pumpingStart", () => {
  it("starts from the fallback, as a total, when nothing was pumped yet", () => {
    expect(pumpingStart([], 90, 10)).toEqual({ split: false, amount: 90, left: 50, right: 40 });
    expect(pumpingStart(undefined, 3, 0.5)).toEqual({ split: false, amount: 3, left: 1.5, right: 1.5 });
  });

  it("opens the way the last session was logged, whatever order the list is in", () => {
    const total = { start: at(8), end: at(8, 15), amount: 120 };
    const sided = { start: at(12), end: at(12, 15), amount: 100, amount_left: 45, amount_right: 55 };
    expect(pumpingStart([total, sided], 90, 10)).toEqual({ split: true, amount: 100, left: 45, right: 55 });
    expect(pumpingStart([sided, total], 90, 10)).toEqual({ split: true, amount: 100, left: 45, right: 55 });
    const later = { start: at(16), end: at(16, 15), amount: 80 };
    expect(pumpingStart([sided, later, total], 90, 10)).toEqual({ split: false, amount: 80, left: 40, right: 40 });
  });

  it("passes over a session with nothing measured", () => {
    const sided = { start: at(8), end: at(8, 15), amount: 100, amount_left: 45, amount_right: 55 };
    const empty = { start: at(12), end: at(12, 15), amount: null };
    expect(pumpingStart([sided, empty], 90, 10).amount).toBe(100);
  });

  it("starts a side that was not pumped at nothing", () => {
    const oneSide = { start: at(8), end: at(8, 15), amount: 60, amount_left: null, amount_right: 60 };
    expect(pumpingStart([oneSide], 90, 10)).toEqual({ split: true, amount: 60, left: 0, right: 60 });
  });
});

describe("halves", () => {
  it("splits a total into two sides that add up to it, in whole steps", () => {
    expect(halves(90, 10)).toEqual({ left: 50, right: 40 });
    expect(halves(120, 10)).toEqual({ left: 60, right: 60 });
    expect(halves(3.5, 0.5)).toEqual({ left: 2, right: 1.5 });
    expect(halves(0, 10)).toEqual({ left: 0, right: 0 });
  });
});

describe("nursingStart", () => {
  it("starts from a quarter of an hour, and ten minutes a side, with nothing to go by", () => {
    expect(nursingStart([])).toEqual({ minutes: 15, left: 10, right: 10 });
    expect(nursingStart()).toEqual({ minutes: 15, left: 10, right: 10 });
  });

  it("starts from how long the last feed on one side took, pauses left out", () => {
    const feeds = [
      { method: "left breast", start: at(8), end: at(8, 22) },
      { method: "right breast", start: at(11), end: at(11, 20), paused_seconds: 480 },
      { method: "bottle", start: at(13), end: at(13, 40), amount: 120 },
    ];
    expect(nursingStart(feeds).minutes).toBe(12);
    expect(nursingStart([...feeds].reverse()).minutes).toBe(12);
  });

  it("starts each side from the last feed that timed both", () => {
    const feeds = [
      { method: "both breasts", start: at(8), end: at(8, 20), left_seconds: 720, right_seconds: 480 },
      { method: "both breasts", start: at(11), end: at(11, 15) }, // both, but not timed side by side
    ];
    expect(nursingStart(feeds)).toEqual({ minutes: 15, left: 12, right: 8 });
  });

  it("learns nothing from a feed with no length, and keeps within reason", () => {
    expect(nursingStart([{ method: "left breast", start: at(8), end: at(8) }]).minutes).toBe(15);
    expect(nursingStart([{ method: "left breast", start: at(1), end: at(9) }]).minutes).toBe(120);
    expect(nursingStart([{ method: "both breasts", start: at(8), end: at(8, 1), left_seconds: 20, right_seconds: 45 }])).toMatchObject({ left: 1, right: 1 });
  });
});

describe("nursingLength", () => {
  it("is the minutes said for a feed on one side", () => {
    expect(nursingLength("left breast", { minutes: 12, left: 10, right: 10 })).toEqual({ minutes: 12 });
  });

  it("adds up the two sides of a feed on both, and keeps each", () => {
    expect(nursingLength("both breasts", { minutes: 15, left: 12, right: 8 })).toEqual({ minutes: 20, left_seconds: 720, right_seconds: 480 });
  });
});

describe("sidesText", () => {
  it("says what each breast gave in a pumping session", () => {
    expect(sidesText({ amount: 90, amount_left: 40, amount_right: 50 }, { t, volume: "mL" })).toBe("Left 40 mL · Right 50 mL");
    expect(sidesText({ amount: 3.5, amount_left: 2, amount_right: 1.5 }, { t, volume: "oz" })).toBe("Left 2 oz · Right 1.5 oz");
  });

  it("leaves out a side that was not pumped", () => {
    expect(sidesText({ amount: 60, amount_left: null, amount_right: 60 }, { t, volume: "mL" })).toBe("Right 60 mL");
  });

  it("says how long each side took in a feed on both breasts", () => {
    expect(sidesText({ method: "both breasts", left_seconds: 720, right_seconds: 480 }, { t, volume: "mL" })).toBe("Left 12m · Right 8m");
    expect(sidesText({ method: "both breasts", left_seconds: 3900, right_seconds: 3600 }, { t, volume: "mL" })).toBe("Left 1h 5m · Right 1h");
  });

  it("has nothing to say about an entry without sides", () => {
    expect(sidesText({ amount: 90 }, { t, volume: "mL" })).toBeNull();
    expect(sidesText({ method: "left breast", start: at(8), end: at(8, 10) }, { t, volume: "mL" })).toBeNull();
    expect(sidesText({ method: "both breasts" }, { t, volume: "mL" })).toBeNull();
  });
});
