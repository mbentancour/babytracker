import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import GrowthTab from "./GrowthTab";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderGrowthTab({ features, monthlyPumping = [], monthlyFeedings = [], monthlySleep = [] } = {}) {
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
          monthlyFeedings={monthlyFeedings}
          monthlySleep={monthlySleep}
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

// The amount and the count are separate graphs; each is split by kind, with a
// key under it once there are two kinds to tell apart.
describe("GrowthTab splits by type", () => {
  const today = (hour, minutes = 0) => {
    const at = new Date();
    at.setHours(hour, minutes, 0, 0);
    return at.toISOString();
  };
  const cards = (title) => screen.getAllByText(title).map((el) => el.closest(".section-card"));
  const key = (card) => [...card.querySelectorAll(".chart-key span")].map((el) => el.textContent).filter(Boolean);

  it("names the feeding types under the amount and the count graphs", () => {
    renderGrowthTab({
      monthlyFeedings: [
        { id: 1, start: today(8), end: today(8), type: "formula", method: "bottle", amount: 120 },
        { id: 2, start: today(9), end: today(9), type: "breast milk", method: "bottle", amount: 90 },
        { id: 3, start: today(10), end: today(10, 15), type: "breast milk", method: "left breast" },
      ],
    });
    const [amount, count] = cards(FEEDING_TITLE);
    expect(key(amount)).toEqual(["Breast Milk", "Formula"]);
    expect(key(count)).toEqual(["Breast Milk", "Formula"]);
  });

  it("leaves a type out of the amount graph when none of it was measured", () => {
    renderGrowthTab({
      monthlyFeedings: [
        { id: 1, start: today(8), end: today(8), type: "formula", method: "bottle", amount: 120 },
        { id: 3, start: today(10), end: today(10, 15), type: "breast milk", method: "left breast" },
      ],
    });
    const [amount, count] = cards(FEEDING_TITLE);
    // One type has an amount: nothing to tell apart there, two in the count.
    expect(key(amount)).toEqual([]);
    expect(key(count)).toEqual(["Breast Milk", "Formula"]);
  });

  it("splits sleep into night sleep and naps, until the switch narrows it to one", () => {
    renderGrowthTab({
      monthlySleep: [
        { id: 3, start: today(0, 30), end: today(6), nap: false },
        { id: 4, start: today(9), end: today(10), nap: true },
      ],
    });
    const [hours, count] = cards(SLEEP_TITLE);
    expect(key(hours)).toEqual(["Night sleep", "Nap"]);
    expect(key(count)).toEqual(["Night sleep", "Nap"]);

    fireEvent.click(within(hours).getByRole("button", { name: "Nap" }));
    expect(key(cards(SLEEP_TITLE)[0])).toEqual([]);
    expect(key(cards(SLEEP_TITLE)[1])).toEqual([]);
  });
});

// Which graphs show, and in what order, is up to whoever is looking: the
// Customize button above them hides and moves them, and the device remembers.
describe("GrowthTab customizing", () => {
  const graphs = () => [...document.querySelectorAll(".section-card-title")].map((title) => title.textContent);
  const press = (name) => fireEvent.click(screen.getByRole("button", { name }));
  const BUILT_IN = [
    "Daily Feeding - Amount (30d)",
    "Daily Feedings - Count (30d)",
    "Daily Sleep - Hours (30d)",
    "Daily Sleep - Count (30d)",
    "Weight Trend",
    "Height Trend",
    "Head Circumference",
    "BMI Trend",
  ];

  it("hides a graph and moves another, and still has them that way later", () => {
    renderGrowthTab();
    expect(graphs()).toEqual(BUILT_IN);

    press("Customize");
    // While arranging, the graphs make way for their names.
    expect(graphs()).toEqual([]);
    press("Hide Daily Sleep - Count (30d)");
    press("Move BMI Trend earlier");
    press("Done");
    const arranged = [
      "Daily Feeding - Amount (30d)",
      "Daily Feedings - Count (30d)",
      "Daily Sleep - Hours (30d)",
      "Weight Trend",
      "Height Trend",
      "BMI Trend",
      "Head Circumference",
    ];
    expect(graphs()).toEqual(arranged);
    expect(screen.getByText("1 hidden")).toBeTruthy();

    cleanup();
    renderGrowthTab();
    expect(graphs()).toEqual(arranged);
  });

  it("leaves the measurement tiles and the averages where they are", () => {
    renderGrowthTab();
    press("Customize");
    expect(screen.getByText("Avg Feeding")).toBeTruthy();
    expect(screen.getByText("Avg Sleep")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hide Avg/ })).toBeNull();
  });

  it("puts graphs that only turn up later beside the ones they belong with", () => {
    // Arranged while there was nothing pumped to chart…
    renderGrowthTab();
    press("Customize");
    press("Move Weight Trend earlier");
    press("Done");
    expect(graphs().slice(0, 5)).toEqual([
      "Daily Feeding - Amount (30d)",
      "Daily Feedings - Count (30d)",
      "Daily Sleep - Hours (30d)",
      "Weight Trend",
      "Daily Sleep - Count (30d)",
    ]);

    // …then pumping starts: its graphs follow the other daily ones, not BMI.
    cleanup();
    renderGrowthTab({ monthlyPumping: pumpingEntry() });
    expect(graphs()).toEqual([
      "Daily Feeding - Amount (30d)",
      "Daily Feedings - Count (30d)",
      "Daily Sleep - Hours (30d)",
      "Weight Trend",
      "Daily Sleep - Count (30d)",
      "Daily Pumping - Amount (30d)",
      "Daily Pumping - Count (30d)",
      "Height Trend",
      "Head Circumference",
      "BMI Trend",
    ]);
  });

  it("does not offer graphs of a feature that is switched off", () => {
    renderGrowthTab({ features: { sleep: false, bmi: false } });
    press("Customize");
    expect(screen.queryByRole("button", { name: /^Hide Daily Sleep/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide BMI Trend" })).toBeNull();
    expect(screen.getByRole("button", { name: "Hide Weight Trend" })).toBeTruthy();
  });
});
