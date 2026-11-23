import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OverviewTab from "./OverviewTab";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

function renderOverview({ sleepEntries = [], weeklySleep = [] } = {}) {
  return render(
    <I18nProvider>
      <PreferencesProvider>
        <OverviewTab
          feedings={[]}
          weeklyFeedings={[]}
          sleepEntries={sleepEntries}
          weeklySleep={weeklySleep}
          changes={[]}
          weeklyChanges={[]}
          tummyTimes={[]}
          weeklyTummyTimes={[]}
          pumpingSessions={[]}
          weeklyPumping={[]}
          temperatures={[]}
          medications={[]}
        />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

function sleepEntry(id, start, end, nap) {
  return {
    id,
    start: start.toISOString(),
    end: end.toISOString(),
    duration: `${String((end - start) / 3600000).padStart(2, "0")}:00:00`,
    nap,
  };
}

describe("OverviewTab sleep controls", () => {
  it("defaults the sleep statistic to today and can switch to the rolling 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 15, 0, 0));
    const yesterday = new Date(2026, 9, 4, 15, 0, 0);
    const lastNightEnd = new Date(2026, 9, 4, 23, 0, 0);
    const todayStart = new Date(2026, 9, 5, 13, 0, 0);
    const todayEnd = new Date(2026, 9, 5, 14, 0, 0);

    renderOverview({
      sleepEntries: [
        sleepEntry(1, yesterday, lastNightEnd, false),
        sleepEntry(2, todayStart, todayEnd, true),
      ],
    });

    expect(screen.getByText("1.0h")).toBeTruthy();
    const periodToggle = screen.getByRole("group", { name: "Sleep period" });
    fireEvent.click(within(periodToggle).getByRole("button", { name: "24h" }));
    expect(screen.getByText("9.0h")).toBeTruthy();
    expect(within(periodToggle).getByRole("button", { name: "24h" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters the sleep rhythm timeline by nap or night sleep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 15, 0, 0));
    renderOverview({
      sleepEntries: [
        sleepEntry(1, new Date(2026, 9, 5, 13, 0, 0), new Date(2026, 9, 5, 14, 0, 0), true),
        sleepEntry(2, new Date(2026, 9, 5, 9, 0, 0), new Date(2026, 9, 5, 10, 0, 0), false),
      ],
    });

    const typeToggle = screen.getByRole("group", { name: "Sleep type" });
    expect(screen.getByText("1.0h · Nap")).toBeTruthy();
    expect(screen.getByText("1.0h · Night sleep")).toBeTruthy();

    fireEvent.click(within(typeToggle).getByRole("button", { name: "Nap" }));
    expect(screen.getByText("1.0h · Nap")).toBeTruthy();
    expect(screen.queryByText("1.0h · Night sleep")).toBeNull();
    expect(within(typeToggle).getByRole("button", { name: "Nap" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the diaper card between total, wet and solid", () => {
    renderOverview();

    const diaperToggle = screen.getByRole("group", { name: "Diaper filter" });
    const totalButton = within(diaperToggle).getByRole("button", { name: "Total" });
    const solidButton = within(diaperToggle).getByRole("button", { name: "Solid" });
    expect(totalButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(solidButton);
    expect(solidButton.getAttribute("aria-pressed")).toBe("true");
    expect(totalButton.getAttribute("aria-pressed")).toBe("false");
  });
});
