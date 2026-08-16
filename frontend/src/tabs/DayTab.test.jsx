import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";
import { localInputToUTC } from "../utils/datetime";
import { toLocalDateKey } from "../hooks/useDayData";

// Every list endpoint the Day view touches, stubbed. Each returns an empty
// page unless a test overrides it, so a test only has to describe the data it
// actually cares about.
//
// vi.mock is hoisted above every top-level statement, so the method list lives
// inside the factory; the outer copy below is only for iterating in beforeEach.
vi.mock("../api", () => ({
  api: Object.fromEntries(
    [
      "getFeedings", "getSleep", "getChanges", "getTummyTimes", "getPumping",
      "getTemperature", "getMedications", "getNotes", "getMilestones",
      "getWeight", "getHeight", "getHeadCircumference", "getBMI", "getMilkWaste",
    ].map((m) => [m, vi.fn(async () => ({ results: [] }))]),
  ),
}));

const { api: apiMock } = await import("../api");
const { default: DayTab } = await import("./DayTab");

beforeEach(() => {
  Object.values(apiMock).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderDayTab(props = {}) {
  return render(
    <I18nProvider>
      <PreferencesProvider>
        <DayTab childId={1} {...props} />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

describe("DayTab", () => {
  // The day the user means is their local Tuesday, but the API parses
  // timestamps as UTC. Sending local wall-clock straight through silently
  // drops entries by the size of the UTC offset at each end of the day —
  // it doesn't error, it just quietly shows less than happened.
  it("asks for the local day converted to UTC, not raw wall-clock", async () => {
    renderDayTab();

    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());

    const today = toLocalDateKey(new Date());
    const params = apiMock.getFeedings.mock.calls[0][0];
    expect(params.start_min).toBe(localInputToUTC(`${today}T00:00:00`));
    expect(params.start_max).toBe(localInputToUTC(`${today}T23:59:59`));
  });

  // Measurements and milestones are stored as a bare DATE, so they filter on
  // the plain local date. Converting those to UTC would shift them a day for
  // anyone west of Greenwich.
  it("filters date-only entries on the plain local date", async () => {
    renderDayTab();

    await waitFor(() => expect(apiMock.getWeight).toHaveBeenCalled());

    const today = toLocalDateKey(new Date());
    expect(apiMock.getWeight.mock.calls[0][0].date_min).toBe(today);
    expect(apiMock.getMilestones.mock.calls[0][0].date_max).toBe(today);
  });

  it("reaches back a day for sleep, which can start the previous evening", async () => {
    renderDayTab();

    await waitFor(() => expect(apiMock.getSleep).toHaveBeenCalled());

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(apiMock.getSleep.mock.calls[0][0].start_min).toBe(
      localInputToUTC(`${toLocalDateKey(yesterday)}T00:00:00`),
    );
  });

  it("skips endpoints the user can't read", async () => {
    renderDayTab({ canRead: (f) => f !== "medication" });

    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());
    expect(apiMock.getMedications).not.toHaveBeenCalled();
  });

  // Uneaten milk is opt-in, so the default install must not pay for the
  // request at all.
  it("does not fetch uneaten milk unless the milk-stock view is on", async () => {
    renderDayTab();
    await waitFor(() => expect(apiMock.getFeedings).toHaveBeenCalled());
    expect(apiMock.getMilkWaste).not.toHaveBeenCalled();

    cleanup();
    localStorage.setItem(
      "babytracker_preferences",
      JSON.stringify({ views: { day: true, routine: true, milkStock: true } }),
    );
    renderDayTab();
    await waitFor(() => expect(apiMock.getMilkWaste).toHaveBeenCalled());
  });

  it("orders entries by the time they happened, across types", async () => {
    const at = (h, m) => {
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    apiMock.getFeedings.mockResolvedValueOnce({
      results: [{ id: 1, start: at(9, 0), end: at(9, 20), type: "breast milk", method: "bottle", amount: 120 }],
    });
    apiMock.getChanges.mockResolvedValueOnce({
      results: [{ id: 2, time: at(7, 30), wet: true, solid: false }],
    });

    renderDayTab();

    await waitFor(() => expect(screen.getByText("Diaper")).toBeTruthy());
    const labels = screen.getAllByText(/^(Feeding|Diaper)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Diaper", "Feeding"]);
  });

  it("shows an empty state when nothing was logged", async () => {
    renderDayTab();
    await waitFor(() => expect(screen.getByText("Nothing logged on this day")).toBeTruthy());
  });
});
