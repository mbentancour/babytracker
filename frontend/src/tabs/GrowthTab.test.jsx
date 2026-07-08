import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import GrowthTab from "./GrowthTab";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderGrowthTab({ features } = {}) {
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
          child={null}
        />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

// Matches both feeding chart titles ("Daily Feeding - Amount (30d)" and
// "Daily Feedings - Count (30d)") without pinning the exact wording.
const FEEDING_TITLE = /^Daily Feeding/;

describe("GrowthTab feature toggles", () => {
  it("shows all charts by default", () => {
    renderGrowthTab();
    expect(screen.getAllByText(FEEDING_TITLE).length).toBe(2);
    expect(screen.getByText("Daily Sleep (30d)")).toBeTruthy();
    expect(screen.getByText("Weight Trend")).toBeTruthy();
    expect(screen.getByText("Height Trend")).toBeTruthy();
    expect(screen.getByText("Head Circumference")).toBeTruthy();
    expect(screen.getByText("BMI Trend")).toBeTruthy();
  });

  it("hides both feeding charts when the feeding feature is disabled", () => {
    renderGrowthTab({ features: { feeding: false } });
    expect(screen.queryAllByText(FEEDING_TITLE).length).toBe(0);
    expect(screen.getByText("Daily Sleep (30d)")).toBeTruthy();
  });

  it("hides the sleep chart when the sleep feature is disabled", () => {
    renderGrowthTab({ features: { sleep: false } });
    expect(screen.queryByText("Daily Sleep (30d)")).toBeNull();
    expect(screen.getAllByText(FEEDING_TITLE).length).toBe(2);
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
