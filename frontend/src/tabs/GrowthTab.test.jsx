import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import GrowthTab from "./GrowthTab";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderGrowthTab({ features, monthlyPumping = [] } = {}) {
  if (features) {
    localStorage.setItem("babytracker_preferences", JSON.stringify({ features }));
  }
  render(
    <I18nProvider>
      <PreferencesProvider>
        <GrowthTab
          weights={[]}
          heights={[]}
          headCircumferences={[]}
          bmiEntries={[]}
          monthlyFeedings={[]}
          monthlySleep={[]}
          monthlyPumping={monthlyPumping}
          child={null}
        />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

// Match chart-title pairs ("... - Amount (30d)" / "... - Count (30d)")
// without pinning the exact wording.
const FEEDING_TITLE = /^Daily Feeding/;
const SLEEP_TITLE = /^Daily Sleep/;
const PUMPING_TITLE = /^Daily Pumping/;

// The pumping charts are data-gated, so tests that expect them must feed
// at least one entry within the 30-day window.
const pumpingEntry = () => {
  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 20 * 60 * 1000);
  return [{ id: 1, child: 1, start: start.toISOString(), end: end.toISOString(), amount: 120 }];
};

describe("GrowthTab feature toggles", () => {
  it("shows all charts by default", () => {
    renderGrowthTab();
    expect(screen.getAllByText(FEEDING_TITLE).length).toBe(2);
    expect(screen.getAllByText(SLEEP_TITLE).length).toBe(2);
    expect(screen.getByText("Weight Trend")).toBeTruthy();
    expect(screen.getByText("Height Trend")).toBeTruthy();
    expect(screen.getByText("Head Circumference")).toBeTruthy();
    expect(screen.getByText("BMI Trend")).toBeTruthy();
  });

  it("hides both feeding charts when the feeding feature is disabled", () => {
    renderGrowthTab({ features: { feeding: false } });
    expect(screen.queryAllByText(FEEDING_TITLE).length).toBe(0);
    expect(screen.getAllByText(SLEEP_TITLE).length).toBe(2);
  });

  it("hides both sleep charts when the sleep feature is disabled", () => {
    renderGrowthTab({ features: { sleep: false } });
    expect(screen.queryAllByText(SLEEP_TITLE).length).toBe(0);
    expect(screen.getAllByText(FEEDING_TITLE).length).toBe(2);
  });

  it("shows both pumping charts only when pumping data exists", () => {
    renderGrowthTab();
    expect(screen.queryAllByText(PUMPING_TITLE).length).toBe(0);
    cleanup();
    renderGrowthTab({ monthlyPumping: pumpingEntry() });
    expect(screen.getAllByText(PUMPING_TITLE).length).toBe(2);
  });

  it("hides both pumping charts when the pumping feature is disabled", () => {
    renderGrowthTab({ features: { pumping: false }, monthlyPumping: pumpingEntry() });
    expect(screen.queryAllByText(PUMPING_TITLE).length).toBe(0);
  });

  it("hides the BMI tile and chart when the bmi feature is disabled", () => {
    renderGrowthTab({ features: { bmi: false } });
    expect(screen.queryByText("BMI Trend")).toBeNull();
    expect(screen.queryByText("BMI")).toBeNull();
    expect(screen.getByText("Weight Trend")).toBeTruthy();
  });

  it("hides measurement tiles and trend charts for disabled growth features", () => {
    renderGrowthTab({ features: { weight: false, height: false, headcirc: false } });
    expect(screen.queryByText("Weight Trend")).toBeNull();
    expect(screen.queryByText("Height Trend")).toBeNull();
    expect(screen.queryByText("Head Circumference")).toBeNull();
    expect(screen.getByText("BMI Trend")).toBeTruthy();
  });
});
