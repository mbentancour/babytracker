import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

vi.mock("../api", () => ({
  api: Object.fromEntries(
    ["getFeedings", "getSleep", "getChanges", "getTummyTimes", "getPumping"]
      .map((m) => [m, vi.fn(async () => ({ results: [] }))]),
  ),
}));

const { api: apiMock } = await import("../api");
const { default: RoutineTab } = await import("./RoutineTab");

beforeEach(() => {
  // Reset, not clear: a test that sets a persistent mockResolvedValue would
  // otherwise leak its data into every test after it.
  Object.values(apiMock).forEach((fn) => {
    fn.mockReset();
    fn.mockResolvedValue({ results: [] });
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderRoutineTab(props = {}, prefs = null) {
  if (prefs) localStorage.setItem("babytracker_preferences", JSON.stringify(prefs));
  return render(
    <I18nProvider>
      <PreferencesProvider>
        <RoutineTab childId={1} {...props} />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

const marks = (container) => Array.from(container.querySelectorAll(".routine-mark"));
const columns = (container) => Array.from(container.querySelectorAll(".routine-col"));

// Entries are positioned as a percentage down a continuous 24-hour track, so
// the assertions read the inline top/height rather than a cell coordinate.
const pct = (style) => parseFloat(style);

describe("RoutineTab", () => {
  it("draws one column per day of the selected period", async () => {
    const { container } = renderRoutineTab();
    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());

    // 14 days is the default: a week is too short to read a rhythm off.
    expect(columns(container).length).toBe(14);
  });

  it("lets the period be widened, and refetches for it", async () => {
    const { container } = renderRoutineTab({}, { routineDays: 30 });
    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());

    expect(columns(container).length).toBe(30);

    // The fetch window has to widen with it, or the extra columns are empty.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    const { start_min: min } = apiMock.getFeedings.mock.calls[0][0];
    expect(new Date(min).getTime()).toBeLessThanOrEqual(thirtyDaysAgo.getTime() + 24 * 3600 * 1000);
  });

  it("remembers the chosen period", async () => {
    const { container } = renderRoutineTab();
    await waitFor(() => expect(columns(container).length).toBe(14));

    screen.getByRole("button", { name: /^7/ }).click();
    await waitFor(() => expect(columns(container).length).toBe(7));

    expect(JSON.parse(localStorage.getItem("babytracker_preferences")).routineDays).toBe(7);
  });

  it("places a point activity at the fraction of the day it happened", async () => {
    const at = new Date();
    at.setHours(6, 0, 0, 0);
    apiMock.getChanges.mockResolvedValue({
      results: [{ id: 1, time: at.toISOString(), wet: true, solid: false }],
    });

    const { container } = renderRoutineTab();
    await waitFor(() => expect(marks(container).length).toBe(1));

    const [mark] = marks(container);
    expect(mark.className).toContain("routine-mark-point");
    // 06:00 is a quarter of the way down the track.
    expect(pct(mark.style.top)).toBeCloseTo(25, 1);
    expect(mark.style.height).toBe("");
  });

  // The whole reason for moving off per-hour cells: a nine-hour night used to
  // render as nine stitched segments, and the seams read as separate naps.
  it("draws a multi-hour sleep as one continuous block", async () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    apiMock.getSleep.mockResolvedValue({
      results: [{ id: 1, start: start.toISOString(), end: end.toISOString(), nap: true }],
    });

    const { container } = renderRoutineTab();
    await waitFor(() => expect(marks(container).length).toBe(1));

    const [mark] = marks(container);
    expect(pct(mark.style.top)).toBeCloseTo(50, 1); // noon
    expect(pct(mark.style.height)).toBeCloseTo(12.5, 1); // 3h of 24
  });

  // An overnight sleep is one entry but two visible pieces: it should reach the
  // bottom of one column and continue from the top of the next.
  it("splits a sleep that crosses midnight across two columns", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 2);
    start.setHours(21, 0, 0, 0);
    const end = new Date(start.getTime() + 9 * 60 * 60 * 1000); // 06:00 next day

    apiMock.getSleep.mockResolvedValue({
      results: [{ id: 1, start: start.toISOString(), end: end.toISOString(), nap: false }],
    });

    const { container } = renderRoutineTab();
    await waitFor(() => expect(marks(container).length).toBe(2));

    const [first, second] = marks(container);
    // Evening piece: starts at 21:00 and runs to the bottom.
    expect(pct(first.style.top)).toBeCloseTo(87.5, 1);
    expect(pct(first.style.top) + pct(first.style.height)).toBeCloseTo(100, 1);
    // Morning piece: starts at midnight.
    expect(pct(second.style.top)).toBeCloseTo(0, 1);
    expect(pct(second.style.height)).toBeCloseTo(25, 1); // 6h
  });

  it("keeps a very short session visible", async () => {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    apiMock.getTummyTimes.mockResolvedValue({
      results: [{ id: 1, start: start.toISOString(), end: new Date(start.getTime() + 60000).toISOString() }],
    });

    const { container } = renderRoutineTab();
    await waitFor(() => expect(marks(container).length).toBe(1));
    // One minute is 0.07% of a day — it would round away to nothing.
    expect(pct(marks(container)[0].style.height)).toBeGreaterThan(0.5);
  });

  it("hides an activity when its chip is switched off, and remembers it", async () => {
    const at = new Date();
    at.setHours(9, 0, 0, 0);
    apiMock.getPumping.mockResolvedValue({
      results: [{ id: 1, start: at.toISOString(), end: at.toISOString(), amount: 100 }],
    });

    const { container } = renderRoutineTab();
    await waitFor(() => expect(marks(container).length).toBe(1));

    screen.getByRole("button", { name: /pumping/i }).click();
    await waitFor(() => expect(marks(container).length).toBe(0));

    expect(JSON.parse(localStorage.getItem("babytracker_preferences")).routineHidden).toEqual(["pumping"]);
  });

  it("skips endpoints the user can't read", async () => {
    renderRoutineTab({ canRead: (f) => f !== "pumping" });
    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());
    expect(apiMock.getPumping).not.toHaveBeenCalled();
  });

  it("shows an empty state when the window has nothing in it", async () => {
    renderRoutineTab();
    await waitFor(() => expect(screen.getByText(/Nothing logged/)).toBeTruthy());
  });
});
