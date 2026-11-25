import { describe, it, expect } from "vitest";
import { splitDaily } from "./dailySplit";

describe("splitDaily", () => {
  it("adds what each part contributed to every day of the total", () => {
    const total = [{ date: "Nov 24", hours: 13.5 }, { date: "Nov 25", hours: 9 }];
    const night = [{ date: "Nov 24", hours: 10.5 }, { date: "Nov 25", hours: 9 }];
    const nap = [{ date: "Nov 24", hours: 3 }];
    expect(splitDaily(total, { night, nap }, "hours")).toEqual([
      { date: "Nov 24", hours: 13.5, night: 10.5, nap: 3 },
      { date: "Nov 25", hours: 9, night: 9, nap: 0 },
    ]);
  });

  it("ignores days a part has that the total does not, and takes any number of parts", () => {
    const total = [{ date: "Nov 25", count: 4 }];
    const nap = [{ date: "Nov 20", count: 2 }, { date: "Nov 25", count: 3 }];
    expect(splitDaily(total, { nap }, "count")).toEqual([{ date: "Nov 25", count: 4, nap: 3 }]);
    expect(splitDaily(total, {}, "count")).toEqual(total);
  });
});
