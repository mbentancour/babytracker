import { describe, expect, it } from "vitest";
import { getPointSelection } from "./chartSelection";

describe("getPointSelection", () => {
  it("selects the active point for daily sleep hours", () => {
    const series = [
      { date: "Sep 20", hours: 25 },
      { date: "Sep 21", hours: 0 },
      { date: "Sep 23", hours: 0 },
    ];
    expect(getPointSelection(series[0], series, "hours")).toEqual({
      label: "Sep 20",
      value: 25,
      entry: undefined,
    });
  });

  it("matches a copied point by date", () => {
    const series = [
      { date: "Sep 20", count: 2 },
      { date: "Sep 21", count: 0 },
      { date: "Sep 23", count: 1 },
    ];
    expect(getPointSelection({ date: "Sep 23" }, series, "count")).toMatchObject({
      label: "Sep 23",
      value: 1,
    });
  });

  it("preserves numeric timestamps for weight and height labels", () => {
    const timestamp = new Date(2026, 9, 4).getTime();
    const series = [{ timestamp, date: "Oct 4", weight: 5, entry: { id: 1 } }];
    expect(getPointSelection(series[0], series, "weight")).toEqual({
      label: timestamp,
      value: 5,
      entry: { id: 1 },
    });
  });

  it("returns null without an active point or match", () => {
    expect(getPointSelection(null, [{ date: "Sep 20" }], "hours")).toBeNull();
    expect(getPointSelection({ date: "Sep 1" }, [{ date: "Sep 20" }], "hours")).toBeNull();
  });
});
