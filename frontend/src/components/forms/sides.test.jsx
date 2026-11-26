// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../utils/i18n";
import { PreferencesProvider } from "../../utils/preferences";

// The two sides of an entry in the full forms: what each breast gave in a
// pumping session, and how long each took in a feed on both.

const api = vi.hoisted(() => ({
  createPumping: vi.fn(), updatePumping: vi.fn(),
  createFeeding: vi.fn(), updateFeeding: vi.fn(),
  getEntityTags: vi.fn(), setEntityTags: vi.fn(), getTags: vi.fn(),
}));
vi.mock("../../api", () => ({ api }));

import PumpingForm from "./PumpingForm";
import FeedingForm from "./FeedingForm";

const NOW = new Date(2026, 9, 22, 14, 0, 0);
const at = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();
const utc = (minutesAgo) => at(minutesAgo).slice(0, 19);

const show = (form) => render(<I18nProvider><PreferencesProvider>{form}</PreferencesProvider></I18nProvider>);
const field = (name) => screen.getByRole("spinbutton", { name });
const type = (name, value) => fireEvent.change(field(name), { target: { value } });
const submit = () => fireEvent.submit(document.querySelector("form"));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ id: 1, results: [] }));
  api.getEntityTags.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PumpingForm", () => {
  it("saves a total, as it always did", async () => {
    const done = vi.fn();
    show(<PumpingForm childId={7} onDone={done} onClose={() => {}} />);
    type("Amount", "90");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.createPumping).toHaveBeenCalledWith({ child: 7, start: utc(15), end: utc(0), amount: 90 });
  });

  it("adds the two sides up as they are typed, and saves them in place of the total", async () => {
    const done = vi.fn();
    show(<PumpingForm childId={7} onDone={done} onClose={() => {}} />);
    type("Left", "40");
    expect(field("Total").value).toBe("40");
    type("Right", "50.5");
    // The amount is now theirs: shown, not typed.
    expect(field("Total").value).toBe("90.5");
    expect(field("Total").readOnly).toBe(true);
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.createPumping).toHaveBeenCalledWith({ child: 7, start: utc(15), end: utc(0), amount_left: 40, amount_right: 50.5 });
  });

  it("opens a session logged side by side with its sides, and saves a corrected one", async () => {
    const entry = { id: 31, start: at(30), end: at(15), amount: 90, amount_left: 40, amount_right: 50 };
    const done = vi.fn();
    show(<PumpingForm childId={7} entry={entry} onDone={done} onClose={() => {}} />);
    expect(field("Left").value).toBe("40");
    expect(field("Right").value).toBe("50");
    expect(field("Total").value).toBe("90");
    type("Left", "45");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.updatePumping).toHaveBeenCalledWith(31, { start: utc(30), end: utc(15), amount_left: 45, amount_right: 50 });
  });

  it("goes back to a total when both sides are cleared", async () => {
    const entry = { id: 31, start: at(30), end: at(15), amount: 90, amount_left: 40, amount_right: 50 };
    const done = vi.fn();
    show(<PumpingForm childId={7} entry={entry} onDone={done} onClose={() => {}} />);
    type("Left", "");
    type("Right", "");
    // What the session came to is still there, and can be typed again.
    expect(field("Amount").value).toBe("90");
    expect(field("Amount").readOnly).toBe(false);
    type("Amount", "100");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.updatePumping).toHaveBeenCalledWith(31, { start: utc(30), end: utc(15), amount: 100, amount_left: null, amount_right: null });
  });

  it("leaves the sides out of it when a session never had any", async () => {
    const done = vi.fn();
    show(<PumpingForm childId={7} entry={{ id: 32, start: at(30), end: at(15), amount: 90 }} onDone={done} onClose={() => {}} />);
    type("Amount", "80");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.updatePumping).toHaveBeenCalledWith(32, { start: utc(30), end: utc(15), amount: 80 });
  });
});

describe("FeedingForm", () => {
  const pick = (index, value) => fireEvent.change(screen.getAllByRole("combobox")[index], { target: { value } });

  it("asks how long each side took only for a feed on both breasts", () => {
    show(<FeedingForm childId={7} onDone={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("spinbutton", { name: "Left" })).toBeNull();
    pick(1, "left breast");
    expect(screen.queryByRole("spinbutton", { name: "Left" })).toBeNull();
    pick(1, "both breasts");
    expect(field("Left")).toBeTruthy();
    expect(field("Right")).toBeTruthy();
  });

  it("saves the two sides of a new feed, which then lasted as long as they add up to", async () => {
    const done = vi.fn();
    show(<FeedingForm childId={7} defaultMethod="both breasts" onDone={done} onClose={() => {}} />);
    type("Left", "12");
    type("Right", "8");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.createFeeding).toHaveBeenCalledWith({
      child: 7, type: "breast milk", method: "both breasts", start: utc(20), end: utc(0), left_seconds: 720, right_seconds: 480,
    });
  });

  it("saves a feed on both breasts without sides when none are given", async () => {
    const done = vi.fn();
    show(<FeedingForm childId={7} defaultMethod="both breasts" onDone={done} onClose={() => {}} />);
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.createFeeding).toHaveBeenCalledWith({ child: 7, type: "breast milk", method: "both breasts", start: utc(15), end: utc(0) });
  });

  it("sends only the side that was changed, and leaves the times of a saved feed alone", async () => {
    // 95 seconds shows as 1.6 minutes: saving the form must not round it.
    const entry = { id: 41, start: at(40), end: at(20), type: "breast milk", method: "both breasts", left_seconds: 95, right_seconds: 480, paused_seconds: 0 };
    const done = vi.fn();
    show(<FeedingForm childId={7} entry={entry} onDone={done} onClose={() => {}} />);
    expect(field("Left").value).toBe("1.6");
    expect(field("Right").value).toBe("8");
    type("Right", "9.5");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.updateFeeding).toHaveBeenCalledWith(41, {
      type: "breast milk", method: "both breasts", start: utc(40), end: utc(20), paused_seconds: 0, right_seconds: 570,
    });
  });

  it("clears a side that is emptied", async () => {
    const entry = { id: 41, start: at(40), end: at(20), type: "breast milk", method: "both breasts", left_seconds: 720, right_seconds: 480, paused_seconds: 0 };
    const done = vi.fn();
    show(<FeedingForm childId={7} entry={entry} onDone={done} onClose={() => {}} />);
    type("Left", "");
    submit();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.updateFeeding.mock.calls[0][1]).toMatchObject({ left_seconds: null });
    expect(api.updateFeeding.mock.calls[0][1]).not.toHaveProperty("right_seconds");
  });
});
