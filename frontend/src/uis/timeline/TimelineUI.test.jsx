// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "../../utils/i18n";
import { PreferencesProvider } from "../../utils/preferences";
import { formatTime } from "../../utils/formatters";

const session = vi.hoisted(() => ({ value: null }));
vi.mock("../../core/session", () => ({ useSession: () => session.value }));

const api = vi.hoisted(() => ({
  createFeeding: vi.fn(), updateFeeding: vi.fn(), deleteFeeding: vi.fn(),
  createSleep: vi.fn(), updateSleep: vi.fn(), deleteSleep: vi.fn(),
  createChange: vi.fn(), updateChange: vi.fn(), deleteChange: vi.fn(),
  createTummyTime: vi.fn(), createPumping: vi.fn(),
  createTimer: vi.fn(), updateTimer: vi.fn(), deleteTimer: vi.fn(), pauseTimer: vi.fn(), resumeTimer: vi.fn(),
}));
vi.mock("../../api", () => ({ api }));

// The real modal host pulls in every form and Settings; here it only needs to
// say which dialog the UI asked for. The pages are the full UI's tabs, charts
// and all; a stand-in is enough to see that the right one opens.
vi.mock("../../components/AppModals", async () => {
  const { useState } = await import("react");
  return {
    useAppModal: () => {
      const [modal, setModal] = useState(null);
      return { modal, setModal, closeModal: () => setModal(null), handleFormDone: () => setModal(null) };
    },
    default: ({ modal }) => (modal ? <p>full form: {modal.type}{modal.timerId ? ` for timer ${modal.timerId}` : ""}</p> : null),
  };
});
vi.mock("../../tabs/GrowthTab", () => ({ default: () => <p>growth page</p> }));
vi.mock("../../tabs/NotesTab", () => ({ default: () => <p>journal page</p> }));

// One day's entries, as the day hook would fetch them: the night before ends
// at 06:30 and there is a 90 mL bottle of formula at 08:00.
const dayData = vi.hoisted(() => ({ refetch: null, cache: new Map() }));
vi.mock("../../hooks/useDayData", () => ({
  useDayData: (childId, date) => {
    const key = date.toDateString();
    if (!dayData.cache.has(key)) {
      const at = (back, h, m = 0) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - back, h, m).toISOString();
      dayData.cache.set(key, {
        feedings: [{ id: 50, start: at(0, 8), end: at(0, 8), type: "formula", method: "bottle", amount: 90 }],
        sleepEntries: [{ id: 51, start: at(1, 19, 30), end: at(0, 6, 30), nap: false }],
        changes: [], tummyTimes: [], pumping: [], temperatures: [], medications: [], notes: [], milestones: [],
        weights: [], heights: [], headCircumferences: [], bmiEntries: [], milkWaste: [],
      });
    }
    return { entries: dayData.cache.get(key), loading: false, error: null, refetch: dayData.refetch };
  },
}));

import TimelineUI from "./TimelineUI";

const NOW = new Date(2026, 9, 22, 14, 0, 0);
const minsAgo = (n) => new Date(NOW.getTime() - n * 60000);
const iso = (n) => minsAgo(n).toISOString();
const utc = (date) => date.toISOString().slice(0, 19);

// 09:00 nursed on the left for ten minutes, 10:30–12:00 a nap, 13:00 a bottle,
// 13:30 a wet diaper; it is now 14:00.
function makeSession(data = {}, overrides = {}) {
  return {
    canRead: () => true,
    canWrite: () => true,
    deleteEntry: vi.fn(),
    data: {
      child: { id: 7, first_name: "Rosa", birth_date: "2026-08-01" },
      children: [{ id: 7, first_name: "Rosa" }],
      weeklyFeedings: [
        { id: 2, start: iso(60), end: iso(60), method: "bottle", type: "breast milk", amount: 120 },
        { id: 1, start: iso(300), end: iso(290), method: "left breast", type: "breast milk" },
      ],
      weeklySleep: [{ id: 3, start: iso(210), end: iso(120), nap: true }],
      weeklyChanges: [{ id: 5, time: iso(30), wet: true, solid: false }],
      changes: [],
      timers: [],
      tagMaps: {},
      error: null,
      refetch: vi.fn(),
      selectChild: vi.fn(),
      ...data,
    },
    ...overrides,
  };
}

const renderUi = () =>
  render(
    <I18nProvider>
      <PreferencesProvider>
        <TimelineUI />
      </PreferencesProvider>
    </I18nProvider>
  );

const story = () => [...document.querySelectorAll(".tl-rows .tl-title")].map((el) => el.textContent);
const rowOf = (title) => screen.getByText(title, { selector: ".tl-title" }).closest(".tl-row");
const dock = () => screen.getByRole("toolbar", { name: "Add to the log" });
const press = (name) => fireEvent.click(within(dock()).getByRole("button", { name }));

describe("TimelineUI", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    session.value = makeSession();
    Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({}));
    dayData.refetch = vi.fn();
    dayData.cache.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tells the day in order, a sleep as two moments, ending at now", () => {
    renderUi();
    expect(story()).toEqual(["Left Breast · 10m", "Fell asleep", "Woke up", "Bottle · 120 mL", "Diaper · Wet", "Now"]);
    expect(within(rowOf("Woke up")).getByText("slept 1h 30m · Nap")).toBeTruthy();
    expect(within(rowOf("Bottle · 120 mL")).getByText(formatTime(minsAgo(60)))).toBeTruthy();
    // How much the feeds that say so add up to stands beside how many there were.
    expect(screen.getByText("2 feeds · 120 mL · 1h 30m sleep · 1 diaper")).toBeTruthy();
    // The stretch from falling asleep to waking is drawn as one block.
    expect(rowOf("Fell asleep").className).toContain("sleep-after");
    expect(rowOf("Woke up").className).toContain("sleep-before");
    expect(rowOf("Bottle · 120 mL").className).not.toContain("sleep-");
  });

  it("says how things stand at the top", () => {
    renderUi();
    const figure = (label) => screen.getByText(label, { selector: "dt" }).parentElement.textContent;
    expect(figure("Awake")).toContain("2h");
    expect(figure("Last feed")).toContain("1h ago");
    expect(figure("Last feed")).toContain("Bottle · 120 mL");
    expect(figure("Last diaper")).toContain("30m ago");
    expect(figure("Last diaper")).toContain("Wet");
    expect(screen.getByText("Rosa")).toBeTruthy();
    // The figure stands apart from the word "ago", which is set small so
    // that the figure fits a narrow column in every language.
    const value = screen.getByText("Last feed", { selector: "dt" }).parentElement.querySelector(".tl-kpi-value");
    expect(value.querySelector("small").textContent.trim()).toBe("ago");
    expect(value.firstChild.textContent).toBe("1h");
  });

  it("says just now in words for something logged this minute", () => {
    session.value = makeSession({ weeklyChanges: [{ id: 5, time: NOW.toISOString(), wet: true, solid: false }] });
    renderUi();
    const value = screen.getByText("Last diaper", { selector: "dt" }).parentElement.querySelector(".tl-kpi-value");
    expect(value.textContent).toBe("just now");
    expect(value.className).toContain("is-word");
  });

  it("makes the names the switch when there are several children", () => {
    session.value = makeSession({ children: [{ id: 7, first_name: "Rosa", birth_date: "2026-08-01" }, { id: 8, first_name: "Milo", birth_date: "2024-01-15" }] });
    renderUi();
    const switcher = screen.getByRole("group", { name: "Children" });
    // Rosa's name is said once, on the button that is pressed, with her age.
    expect(screen.getAllByText("Rosa")).toHaveLength(1);
    const rosa = within(switcher).getByRole("button", { name: /Rosa/ });
    expect(rosa.getAttribute("aria-pressed")).toBe("true");
    expect(rosa.querySelector(".tl-kid-age")).toBeTruthy();
    const milo = within(switcher).getByRole("button", { name: "Milo" });
    expect(milo.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(milo);
    expect(session.value.data.selectChild).toHaveBeenCalledWith(8);
  });

  it("logs a usual feed in one tap and shows it without waiting for a refresh", async () => {
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(15), end: iso(0), type: "breast milk", method: "bottle", amount: 120 });
    renderUi();
    press("Feeding");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    fireEvent.click(within(tray).getByRole("button", { name: /Bottle · 120 mL/ }));

    await waitFor(() => expect(story().filter((title) => title === "Bottle · 120 mL")).toHaveLength(2));
    // Recorded as the other UIs record it: a quarter of an hour, ending now.
    expect(api.createFeeding).toHaveBeenCalledWith({ child: 7, type: "breast milk", method: "bottle", amount: 120, start: utc(minsAgo(15)), end: utc(NOW) });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(story().slice(-2)).toEqual(["Bottle · 120 mL", "Now"]);
    expect(session.value.data.refetch).toHaveBeenCalled();

    // The new row opens with a way to correct it and a way to take it back.
    // ("More" is also the name of a button on the bar, so ask the strip.)
    fireEvent.click(within(document.querySelector(".tl-strip")).getByRole("button", { name: "More (10 mL)" }));
    await waitFor(() => expect(api.updateFeeding).toHaveBeenCalledWith(9, { amount: 130 }));
    expect(story().slice(-2)).toEqual(["Bottle · 130 mL", "Now"]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.deleteFeeding).toHaveBeenCalledWith(9));
    expect(story()).not.toContain("Bottle · 130 mL");
  });

  it("tells a feed logged just now last, after what happened while it was given", async () => {
    // A diaper five minutes ago falls inside the quarter of an hour the feed covers.
    session.value = makeSession({ weeklyChanges: [{ id: 5, time: iso(5), wet: true, solid: false }] });
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(15), end: iso(0), type: "breast milk", method: "bottle", amount: 120 });
    renderUi();
    press("Feeding");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Feeding" })).getByRole("button", { name: /Bottle · 120 mL/ }));
    await waitFor(() => expect(story().slice(-3)).toEqual(["Diaper · Wet", "Bottle · 120 mL", "Now"]));
    expect(within(rowOf("Diaper · Wet")).getByText(formatTime(minsAgo(5)))).toBeTruthy();
    // The time beside it is when it ended, which is when it was logged.
    expect(within(document.querySelector(".tl-strip").closest(".tl-row")).getByText(formatTime(NOW))).toBeTruthy();
  });

  it("puts right how much was drunk, long after the bottle was logged", async () => {
    renderUi();
    // The bottle from an hour ago: no longer new, and still correctable.
    fireEvent.click(within(rowOf("Bottle · 120 mL")).getByRole("button", { name: /Bottle · 120 mL/ }));
    const strip = document.querySelector(".tl-strip");
    // The unit is said once, at the end of the pair it belongs to.
    expect([...strip.querySelectorAll(".tl-pair")].map((pair) => pair.textContent)).toEqual(["−5+5 min", "−10+10 mL"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Less (10 mL)" }));
    await waitFor(() => expect(api.updateFeeding).toHaveBeenCalledWith(2, { amount: 110 }));
    expect(story()).toContain("Bottle · 110 mL");
    expect(within(strip).getByRole("button", { name: "Edit" })).toBeTruthy();

    // Nursing has no amount to change.
    fireEvent.click(within(rowOf("Left Breast · 10m")).getByRole("button", { name: /Left Breast/ }));
    expect([...document.querySelectorAll(".tl-strip .tl-pair")].map((pair) => pair.textContent)).toEqual(["−5+5 min"]);
  });

  it("moves an entry five minutes at a tap", async () => {
    renderUi();
    fireEvent.click(within(rowOf("Diaper · Wet")).getByRole("button", { name: /Diaper · Wet/ }));
    fireEvent.click(screen.getByRole("button", { name: "5 minutes earlier" }));
    await waitFor(() => expect(api.updateChange).toHaveBeenCalledWith(5, { time: utc(minsAgo(35)) }));
    expect(within(rowOf("Diaper · Wet")).getByText(formatTime(minsAgo(35)))).toBeTruthy();
    // Later would be fine too, but never into the future.
    fireEvent.click(screen.getByRole("button", { name: "5 minutes later" }));
    await waitFor(() => expect(api.updateChange).toHaveBeenLastCalledWith(5, { time: utc(minsAgo(30)) }));
  });

  it("asks twice before deleting", async () => {
    renderUi();
    fireEvent.click(within(rowOf("Diaper · Wet")).getByRole("button", { name: /Diaper · Wet/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap again to confirm" }));
    await waitFor(() => expect(api.deleteChange).toHaveBeenCalledWith(5));
    expect(story()).not.toContain("Diaper · Wet");
  });

  it("opens the full form to edit an entry", () => {
    renderUi();
    fireEvent.click(within(rowOf("Woke up")).getByRole("button", { name: /Woke up/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("full form: sleep")).toBeTruthy();
  });

  it("starts a sleep and ends it with Wake up", async () => {
    api.createTimer.mockResolvedValue({ id: 4, child: 7, name: "sleep", start: NOW.toISOString(), pauses: [], is_paused: false });
    api.createSleep.mockResolvedValue({ id: 11, start: NOW.toISOString(), end: NOW.toISOString(), nap: true });
    renderUi();
    press("Sleep");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Sleep" })).getByRole("button", { name: "Start sleep now" }));

    // The story shows her asleep, and the Sleep button has become Wake up.
    await waitFor(() => expect(story().slice(-2)).toEqual(["Fell asleep", "Now"]));
    expect(api.createTimer).toHaveBeenCalledWith({ child: 7, name: "sleep" });
    expect(screen.getByText("Asleep", { selector: "dt" })).toBeTruthy();
    expect(within(dock()).queryByRole("button", { name: "Sleep" })).toBeNull();

    press("Wake up");
    await waitFor(() => expect(story().slice(-3)).toEqual(["Fell asleep", "Woke up", "Now"]));
    expect(api.createSleep).toHaveBeenCalledWith({ child: 7, timer: 4, end: utc(NOW), nap: true });
    expect(within(dock()).getByRole("button", { name: "Sleep" })).toBeTruthy();

    // Undo puts the timer back where it started.
    api.createTimer.mockResolvedValue({ id: 5, child: 7, name: "sleep", start: NOW.toISOString(), pauses: [], is_paused: false });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.createTimer).toHaveBeenLastCalledWith({ child: 7, name: "sleep", start: utc(NOW) }));
    expect(api.deleteSleep).toHaveBeenCalledWith(11);
    await waitFor(() => expect(within(dock()).getByRole("button", { name: "Wake up" })).toBeTruthy());
  });

  it("starts a sleep that began a while ago", async () => {
    api.createTimer.mockResolvedValue({ id: 4, child: 7, name: "sleep", start: iso(15), pauses: [], is_paused: false });
    renderUi();
    press("Sleep");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Sleep" })).getByRole("button", { name: "15 min ago" }));
    await waitFor(() => expect(api.createTimer).toHaveBeenCalledWith({ child: 7, name: "sleep", start: utc(minsAgo(15)) }));
    // It is told where it began, a quarter of an hour back, and is still going.
    await waitFor(() => expect(story().slice(-2)).toEqual(["Fell asleep", "Now"]));
    const asleep = document.querySelector(".tl-row.is-live");
    expect(within(asleep).getByText(formatTime(minsAgo(15)))).toBeTruthy();
    expect(within(asleep).getByText("Asleep for 15:00")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts a sleep from a time on the clock", async () => {
    api.createTimer.mockResolvedValue({ id: 4, child: 7, name: "sleep", start: new Date(2026, 9, 22, 12, 40).toISOString(), pauses: [], is_paused: false });
    renderUi();
    press("Sleep");
    const tray = screen.getByRole("dialog", { name: "Log Sleep" });
    expect(within(tray).queryByRole("button", { name: "Start from then" })).toBeNull();
    fireEvent.click(within(tray).getByRole("button", { name: "Other time" }));
    // The first of the tray's time fields is the one that just appeared.
    const field = tray.querySelector(".tl-times-one input");
    expect(field.value).toBe("13:15");
    fireEvent.change(field, { target: { value: "12:40" } });
    fireEvent.click(within(tray).getByRole("button", { name: "Start from then" }));
    await waitFor(() => expect(api.createTimer).toHaveBeenCalledWith({ child: 7, name: "sleep", start: utc(new Date(2026, 9, 22, 12, 40)) }));
  });

  it("says what was fed last where the feed is chosen", () => {
    renderUi();
    press("Feeding");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    expect(within(tray).getByText("Last feed: Bottle · 120 mL · 1h ago")).toBeTruthy();
  });

  it("asks how a timed feed was given before saving it", async () => {
    session.value = makeSession({ timers: [{ id: 4, child: 7, name: "feeding", start: iso(12), pauses: [], is_paused: false }] });
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(12), end: NOW.toISOString(), type: "breast milk", method: "left breast" });
    renderUi();
    expect(within(rowOf("Feeding")).getByText("12:00")).toBeTruthy();
    fireEvent.click(within(rowOf("Feeding")).getByRole("button", { name: "Finish" }));
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    expect(within(tray).getByText("Feeding for 12:00. How was it given?")).toBeTruthy();
    fireEvent.click(within(tray).getByRole("button", { name: "Left Breast" }));
    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledWith({ child: 7, timer: 4, end: utc(NOW), type: "breast milk", method: "left breast" }));
    await waitFor(() => expect(story()).toContain("Left Breast · 12m"));
    expect(story()).not.toContain("Feeding");
  });

  it("pauses and discards a running timer from its row", async () => {
    const timer = { id: 4, child: 7, name: "sleep", start: iso(20), pauses: [], is_paused: false };
    session.value = makeSession({ timers: [timer], weeklySleep: [] });
    api.pauseTimer.mockResolvedValue({ ...timer, is_paused: true, pauses: [{ start: NOW.toISOString(), end: null }] });
    renderUi();
    fireEvent.click(within(rowOf("Fell asleep")).getByRole("button", { name: /Fell asleep/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(within(rowOf("Fell asleep")).getByText("Paused · 20:00")).toBeTruthy());
    expect(api.pauseTimer).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Tap again to confirm" }));
    await waitFor(() => expect(api.deleteTimer).toHaveBeenCalledWith(4));
    expect(story()).not.toContain("Fell asleep");
  });

  it("holds a feed's clock from its row, with nothing to open first", async () => {
    const timer = { id: 4, child: 7, name: "feeding", start: iso(12), pauses: [], is_paused: false };
    const asleep = { id: 5, child: 7, name: "sleep", start: iso(40), pauses: [], is_paused: false };
    session.value = makeSession({ timers: [timer, asleep], weeklySleep: [] });
    api.pauseTimer.mockResolvedValue({ ...timer, is_paused: true, pauses: [{ start: NOW.toISOString(), end: null }] });
    api.resumeTimer.mockResolvedValue({ ...timer, pauses: [{ start: NOW.toISOString(), end: NOW.toISOString() }] });
    renderUi();
    // A sleep is rarely paused: that stays behind a tap on its row.
    expect(within(rowOf("Fell asleep")).queryByRole("button", { name: "Pause" })).toBeNull();

    fireEvent.click(within(rowOf("Feeding")).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(within(rowOf("Feeding")).getByText("Paused · 12:00")).toBeTruthy());
    expect(api.pauseTimer).toHaveBeenCalledWith(4);
    // The button below says so too, and stops drawing attention to itself.
    expect(within(dock()).getByRole("button", { name: "12:00" }).className).not.toContain("is-live");

    fireEvent.click(within(rowOf("Feeding")).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(within(rowOf("Feeding")).getByRole("button", { name: "Pause" })).toBeTruthy());
    expect(api.resumeTimer).toHaveBeenCalledWith(4);
  });

  it("holds a feed's clock from its tray, which stays open", async () => {
    const timer = { id: 4, child: 7, name: "feeding", start: iso(12), pauses: [], is_paused: false };
    session.value = makeSession({ timers: [timer] });
    api.pauseTimer.mockResolvedValue({ ...timer, is_paused: true, pauses: [{ start: NOW.toISOString(), end: null }] });
    renderUi();
    press("12:00");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    fireEvent.click(within(tray).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(within(tray).getByText("Paused · Feeding for 12:00. How was it given?")).toBeTruthy());
    expect(api.pauseTimer).toHaveBeenCalledWith(4);
    expect(within(tray).getByRole("button", { name: "Resume" })).toBeTruthy();
    // Still there to finish the feed from.
    expect(within(tray).getByRole("button", { name: "Left Breast" })).toBeTruthy();
  });

  it("holds a tummy time's clock from its tray", async () => {
    const timer = { id: 6, child: 7, name: "tummy", start: iso(3), pauses: [], is_paused: false };
    session.value = makeSession({ timers: [timer] });
    api.pauseTimer.mockResolvedValue({ ...timer, is_paused: true, pauses: [{ start: NOW.toISOString(), end: null }] });
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "03:00" }));
    const tray = screen.getByRole("dialog", { name: "Log Tummy Time" });
    fireEvent.click(within(tray).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(within(tray).getByText("Paused · In progress · 03:00")).toBeTruthy());
    expect(api.pauseTimer).toHaveBeenCalledWith(6);
  });

  it("keeps the tray open and says so when saving fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.createChange.mockRejectedValue(new Error("offline"));
    renderUi();
    press("Diaper");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Diaper Change" })).getByRole("button", { name: "Wet" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't save"));
    expect(screen.getByRole("dialog", { name: "Log Diaper Change" })).toBeTruthy();
    expect(story().filter((title) => title.startsWith("Diaper"))).toHaveLength(1);
  });

  it("logs a diaper in one tap", async () => {
    api.createChange.mockResolvedValue({ id: 12, time: NOW.toISOString(), wet: true, solid: true });
    renderUi();
    press("Diaper");
    fireEvent.click(screen.getByRole("button", { name: "Wet + solid" }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Diaper · Wet + solid", "Now"]));
    expect(api.createChange).toHaveBeenCalledWith({ child: 7, time: utc(NOW), wet: true, solid: true });
  });

  it("logs a feed that isn't one of the usual ones", async () => {
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(30), end: iso(15), type: "formula", method: "bottle", amount: 130 });
    renderUi();
    press("Feeding");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    fireEvent.click(within(tray).getByRole("button", { name: "Something else" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Formula" }));
    fireEvent.click(within(tray).getByRole("button", { name: "More" }));
    fireEvent.click(within(tray).getByRole("button", { name: "15 min ago" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledWith({ child: 7, type: "formula", method: "bottle", amount: 130, start: utc(minsAgo(30)), end: utc(minsAgo(15)) }));
  });

  it("says how long a breastfeed took, starting from how long the last one did", async () => {
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(12), end: NOW.toISOString(), type: "breast milk", method: "left breast" });
    renderUi();
    press("Feeding");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    fireEvent.click(within(tray).getByRole("button", { name: "Something else" }));
    // A bottle is measured, not timed.
    expect(within(tray).queryByText("How long")).toBeNull();
    fireEvent.click(within(tray).getByRole("button", { name: "Left Breast" }));
    // The last feed at the breast took ten minutes.
    expect(within(tray).getByText("10 min")).toBeTruthy();
    fireEvent.click(within(tray).getByRole("button", { name: "More" }));
    fireEvent.click(within(tray).getByRole("button", { name: "More" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledWith({ child: 7, type: "breast milk", method: "left breast", start: utc(minsAgo(12)), end: utc(NOW) }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Left Breast · 12m", "Now"]));
  });

  it("times each side of a feed on both breasts", async () => {
    api.createFeeding.mockResolvedValue({ id: 9, start: iso(20), end: NOW.toISOString(), type: "breast milk", method: "both breasts", left_seconds: 720, right_seconds: 480 });
    renderUi();
    press("Feeding");
    const tray = screen.getByRole("dialog", { name: "Log Feeding" });
    fireEvent.click(within(tray).getByRole("button", { name: "Something else" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Both Breasts" }));
    const left = within(tray).getByRole("group", { name: "Left" });
    const right = within(tray).getByRole("group", { name: "Right" });
    expect(left.textContent).toContain("Left (min)");
    fireEvent.click(within(left).getByRole("button", { name: "More" }));
    fireEvent.click(within(left).getByRole("button", { name: "More" }));
    fireEvent.click(within(right).getByRole("button", { name: "Less" }));
    fireEvent.click(within(right).getByRole("button", { name: "Less" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledWith({
      child: 7, type: "breast milk", method: "both breasts", start: utc(minsAgo(20)), end: utc(NOW), left_seconds: 720, right_seconds: 480,
    }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Both Breasts · 20m", "Now"]));
    expect(within(rowOf("Both Breasts · 20m")).getByText("Left 12m · Right 8m")).toBeTruthy();
  });

  it("gives the form for something else more room, and starts from the short list again next time", () => {
    renderUi();
    press("Feeding");
    let tray = screen.getByRole("dialog", { name: "Log Feeding" });
    expect(tray.className).not.toContain("is-form");
    fireEvent.click(within(tray).getByRole("button", { name: "Something else" }));
    // Marked as a form: a wide screen sets its questions two abreast.
    expect(tray.className).toContain("is-form");
    expect(tray.querySelectorAll(".tl-fields > .tl-field")).toHaveLength(4);

    fireEvent.click(within(tray).getByRole("button", { name: "Close" }));
    press("Feeding");
    tray = screen.getByRole("dialog", { name: "Log Feeding" });
    expect(tray.className).not.toContain("is-form");
    expect(within(tray).getByRole("button", { name: "Something else" })).toBeTruthy();
  });

  it("opens the full form for the things More doesn't log itself", () => {
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Temp" }));
    expect(screen.getByText("full form: temp")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts tummy time from More", async () => {
    api.createTimer.mockResolvedValue({ id: 6, child: 7, name: "tummy", start: NOW.toISOString(), pauses: [], is_paused: false });
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Tummy" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Tummy Time" })).getByRole("button", { name: "Start timer" }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Tummy Time", "Now"]));
    expect(api.createTimer).toHaveBeenCalledWith({ child: 7, name: "tummy" });
  });

  it("logs pumping from More, as a quarter of an hour ending now", async () => {
    api.createPumping.mockResolvedValue({ id: 14, start: iso(15), end: iso(0), amount: 90 });
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Pumping" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Log Pumping" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Pumping · 90 mL", "Now"]));
    expect(api.createPumping).toHaveBeenCalledWith({ child: 7, start: utc(minsAgo(15)), end: utc(NOW), amount: 90 });
  });

  it("logs what each breast gave when pumping, and adds the two up", async () => {
    api.createPumping.mockResolvedValue({ id: 14, start: iso(15), end: iso(0), amount: 90, amount_left: 40, amount_right: 50 });
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Pumping" }));
    const tray = screen.getByRole("dialog", { name: "Log Pumping" });
    // Nothing pumped yet: a total, which is what most sessions are.
    expect(within(tray).getByRole("button", { name: "Total" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(tray).getByRole("button", { name: "Each side" }));
    // The total already there is split in two.
    const left = within(tray).getByRole("group", { name: "Left" });
    const right = within(tray).getByRole("group", { name: "Right" });
    expect(left.textContent).toContain("Left (mL)");
    expect(within(left).getByText("50")).toBeTruthy();
    expect(within(right).getByText("40")).toBeTruthy();
    fireEvent.click(within(left).getByRole("button", { name: "Less" }));
    fireEvent.click(within(right).getByRole("button", { name: "More" }));
    fireEvent.click(within(right).getByRole("button", { name: "More" }));
    expect(within(tray).getByText("Total 100 mL")).toBeTruthy();
    fireEvent.click(within(right).getByRole("button", { name: "Less" }));
    fireEvent.click(within(tray).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createPumping).toHaveBeenCalledWith({ child: 7, start: utc(minsAgo(15)), end: utc(NOW), amount_left: 40, amount_right: 50 }));
    await waitFor(() => expect(story().slice(-2)).toEqual(["Pumping · 90 mL", "Now"]));
    const row = rowOf("Pumping · 90 mL");
    expect(within(row).getByText("Left 40 mL · Right 50 mL")).toBeTruthy();
    // Its total is what the sides add up to, so it has no "more / less" of
    // its own: that would leave the sides saying something else.
    expect(within(row).queryByRole("button", { name: "More (10 mL)" })).toBeNull();
  });

  it("opens the pumping tray the way the last session was logged", () => {
    session.value = makeSession({ weeklyPumping: [{ id: 30, start: iso(200), end: iso(185), amount: 110, amount_left: 50, amount_right: 60 }] });
    renderUi();
    press("More");
    fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Pumping" }));
    const tray = screen.getByRole("dialog", { name: "Log Pumping" });
    expect(within(tray).getByRole("button", { name: "Each side" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(within(tray).getByRole("group", { name: "Left" })).getByText("50")).toBeTruthy();
    expect(within(within(tray).getByRole("group", { name: "Right" })).getByText("60")).toBeTruthy();
    // Back to one figure: what the two came to.
    fireEvent.click(within(tray).getByRole("button", { name: "Total" }));
    expect(within(tray).getByText("110 mL")).toBeTruthy();
  });

  it("changes a pumped total from its row, unless the session was logged side by side", () => {
    session.value = makeSession({
      weeklyPumping: [
        { id: 30, start: iso(200), end: iso(185), amount: 110 },
        { id: 31, start: iso(100), end: iso(85), amount: 90, amount_left: 40, amount_right: 50 },
      ],
    });
    renderUi();
    fireEvent.click(within(rowOf("Pumping · 110 mL")).getByRole("button", { name: /Pumping/ }));
    expect(within(rowOf("Pumping · 110 mL")).getByRole("button", { name: "More (10 mL)" })).toBeTruthy();
    fireEvent.click(within(rowOf("Pumping · 90 mL")).getByRole("button", { name: /Pumping/ }));
    expect(within(rowOf("Pumping · 90 mL")).queryByRole("button", { name: "More (10 mL)" })).toBeNull();
    expect(within(rowOf("Pumping · 90 mL")).getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("is read-only for someone who may only look", () => {
    session.value = makeSession({}, { canWrite: () => false });
    renderUi();
    expect(story()).toContain("Diaper · Wet");
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(rowOf("Diaper · Wet").querySelector("button")).toBeNull();
  });

  it("leaves out what is switched off on this device", () => {
    localStorage.setItem("babytracker_preferences", JSON.stringify({ features: { diaper: false } }));
    renderUi();
    expect(story()).not.toContain("Diaper · Wet");
    expect(screen.queryByText("Last diaper")).toBeNull();
    expect(within(dock()).queryByRole("button", { name: "Diaper" })).toBeNull();
    expect(screen.getByText("2 feeds · 120 mL · 1h 30m sleep")).toBeTruthy();
  });

  it("starts with two days and rolls back to earlier ones", () => {
    const old = new Date(NOW.getTime() - 3 * 24 * 3600000).toISOString();
    session.value = makeSession({ weeklyChanges: [{ id: 5, time: iso(30), wet: true, solid: false }, { id: 4, time: old, wet: false, solid: true }] });
    renderUi();
    expect(story()).not.toContain("Diaper · Solid");
    fireEvent.click(screen.getByRole("button", { name: "Show earlier days" }));
    expect(story()[0]).toBe("Diaper · Solid");
  });

  it("opens the pages that look further back, and Back returns the way you came", async () => {
    renderUi();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    const page = () => screen.getByRole("dialog", { name: "Overview" });
    expect(within(page()).getByText("Today so far")).toBeTruthy();
    expect(within(page()).getByText("2 feeds")).toBeTruthy();
    // How much, beside how often; then sleep and diapers, each on its own row.
    expect([...page().querySelectorAll(".tl-today-value")].map((el) => el.textContent)).toEqual(["2 feeds", "120 mL", "1h 30m sleep", "1 diaper"]);
    expect(within(page()).getByText("Sleep this week")).toBeTruthy();

    fireEvent.click(within(page().querySelector(".tl-links")).getByRole("button", { name: "Growth" }));
    await waitFor(() => expect(screen.getByText("growth page")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(within(page()).getByText("Today so far")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells an older day the same way, a day at a time", async () => {
    renderUi();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Show earlier days" }));
    fireEvent.click(screen.getByRole("button", { name: "Older days" }));
    const page = screen.getByRole("dialog", { name: "Older days" });
    const told = () => [...page.querySelectorAll(".tl-rows .tl-title")].map((el) => el.textContent);

    // It opens on the day before the week the home screen already shows.
    expect(within(page).getByLabelText("Date").value).toBe("2026-10-15");
    expect(told()).toEqual(["Woke up", "Bottle · 90 mL"]);
    expect(within(page).getByText("1 feed · 90 mL · 6h 30m sleep")).toBeTruthy();
    // The night began the evening before: the rail arrives already asleep.
    expect(within(page).getByText("Woke up", { selector: ".tl-title" }).closest(".tl-row").className).toContain("sleep-before");

    fireEvent.click(within(page).getByRole("button", { name: "Previous" }));
    expect(within(page).getByLabelText("Date").value).toBe("2026-10-14");
    fireEvent.click(within(page).getByRole("button", { name: "Next" }));
    fireEvent.change(within(page).getByLabelText("Date"), { target: { value: "2026-09-30" } });
    expect(within(page).getByLabelText("Date").value).toBe("2026-09-30");

    // An entry there can be moved like any other; the day is then fetched again.
    fireEvent.click(within(page).getByRole("button", { name: /Bottle · 90 mL/ }));
    fireEvent.click(within(page).getByRole("button", { name: "5 minutes earlier" }));
    const moved = utc(new Date(2026, 8, 30, 7, 55));
    await waitFor(() => expect(api.updateFeeding).toHaveBeenCalledWith(50, { start: moved, end: moved }));
    await waitFor(() => expect(dayData.refetch).toHaveBeenCalled());

    fireEvent.click(within(page).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("full form: feeding")).toBeTruthy();
  });

  it("opens any day from a day's date", () => {
    renderUi();
    // Today's own date: the page opens on that day, and any other is a step
    // or a date away from there.
    fireEvent.click(screen.getByRole("button", { name: "Thursday, October 22" }));
    const page = screen.getByRole("dialog", { name: "Older days" });
    expect(within(page).getByLabelText("Date").value).toBe("2026-10-22");
    fireEvent.click(within(page).getByRole("button", { name: "Previous" }));
    expect(within(page).getByLabelText("Date").value).toBe("2026-10-21");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the amount out for a family that never writes one down", () => {
    session.value = makeSession({ weeklyFeedings: [{ id: 1, start: iso(300), end: iso(290), method: "left breast", type: "breast milk" }] });
    renderUi();
    expect(screen.getByText("1 feed · 1h 30m sleep · 1 diaper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(within(screen.getByRole("dialog", { name: "Overview" })).queryByText(/mL/)).toBeNull();
  });

  it("goes from one page straight to another, and Back still leads home", async () => {
    renderUi();
    fireEvent.click(screen.getByRole("button", { name: "Growth" }));
    await waitFor(() => expect(screen.getByText("growth page")).toBeTruthy());
    const page = screen.getByRole("dialog", { name: "Growth" });
    expect(within(page).getByRole("button", { name: "Growth" }).getAttribute("aria-current")).toBe("page");
    expect(within(page).getByRole("button", { name: "Journal" }).getAttribute("aria-current")).toBeNull();

    fireEvent.click(within(page).getByRole("button", { name: "Journal" }));
    await waitFor(() => expect(screen.getByText("journal page")).toBeTruthy());
    expect(screen.queryByText("growth page")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows something to start from when nothing has been logged", () => {
    session.value = makeSession({ weeklyFeedings: [], weeklySleep: [], weeklyChanges: [] });
    renderUi();
    expect(screen.getByText("Nothing logged yet today")).toBeTruthy();
    expect(story()).toEqual(["Now"]);
    press("Feeding");
    // With no history, the device's default feed and nursing on either side.
    const options = within(screen.getByRole("dialog", { name: "Log Feeding" })).getAllByRole("button").map((b) => b.textContent);
    expect(options).toEqual(expect.arrayContaining(["Bottle · 120 mLBreast Milk", "Left Breast", "Right Breast"]));
  });
});
