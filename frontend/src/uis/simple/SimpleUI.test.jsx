// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "../../utils/i18n";
import { PreferencesProvider } from "../../utils/preferences";

const session = vi.hoisted(() => ({ value: null }));
vi.mock("../../core/session", () => ({ useSession: () => session.value }));

const api = vi.hoisted(() => ({
  createFeeding: vi.fn(),
  createSleep: vi.fn(),
  createChange: vi.fn(),
  createTummyTime: vi.fn(),
  createPumping: vi.fn(),
}));
vi.mock("../../api", () => ({ api }));

// The real modal host pulls in every form and Settings; here it only needs to
// say which dialog the simple UI asked for.
const modalState = vi.hoisted(() => ({ setModal: null }));
vi.mock("../../components/AppModals", async () => {
  const { useState } = await import("react");
  return {
    useAppModal: () => {
      const [modal, setModal] = useState(null);
      modalState.setModal = setModal;
      return { modal, setModal, closeModal: () => setModal(null), handleFormDone: () => setModal(null) };
    },
    default: ({ modal }) => (modal ? <p>full form: {modal.type}</p> : null),
  };
});

import SimpleUI from "./SimpleUI";

const NOW = new Date(2026, 9, 22, 14, 0, 0);
const minsAgo = (n) => new Date(NOW.getTime() - n * 60000).toISOString();

function makeSession(overrides = {}) {
  return {
    canRead: () => true,
    canWrite: () => true,
    deleteEntry: vi.fn(),
    timer: {
      activeTimers: [],
      pausedTimers: [],
      elapsedMap: {},
      startTimer: vi.fn().mockResolvedValue(undefined),
      stopTimer: vi.fn(),
      resumeTimer: vi.fn(),
      discardTimer: vi.fn().mockResolvedValue(undefined),
    },
    data: {
      child: { id: 7, first_name: "Rosa", birth_date: "2026-08-01" },
      children: [{ id: 7, first_name: "Rosa" }],
      feedings: [{ id: 1 }, { id: 2 }],
      changes: [{ id: 5 }],
      weeklyFeedings: [
        { id: 2, start: minsAgo(60), end: minsAgo(45), method: "bottle", type: "breast milk", amount: 120 },
        { id: 1, start: minsAgo(300), end: minsAgo(290), method: "left breast", type: "breast milk" },
      ],
      weeklySleep: [{ id: 3, start: minsAgo(210), end: minsAgo(120) }],
      weeklyChanges: [{ id: 5, time: minsAgo(30), wet: true, solid: false }],
      weeklyTummyTimes: [{ id: 6, start: minsAgo(122), end: minsAgo(110) }],
      weeklyPumping: [],
      error: null,
      refetch: vi.fn(),
      selectChild: vi.fn(),
    },
    ...overrides,
  };
}

const renderUi = () =>
  render(
    <I18nProvider>
      <PreferencesProvider>
        <SimpleUI />
      </PreferencesProvider>
    </I18nProvider>
  );

const row = (name) => screen.getByText(name, { selector: ".simple-row-title" }).closest(".simple-row");

describe("SimpleUI", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    session.value = makeSession();
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows when each activity last happened and what it was", () => {
    renderUi();
    expect(within(row("Feeding")).getByText("45m ago · 120 mL · Bottle")).toBeTruthy();
    expect(within(row("Sleep")).getByText("Awake for 2h")).toBeTruthy();
    expect(within(row("Diaper")).getByText("30m ago · Wet")).toBeTruthy();
    expect(within(row("Tummy")).getByText("1h 50m ago · 12m")).toBeTruthy();
    expect(within(row("Pumping")).getByText("Nothing logged yet")).toBeTruthy();
    expect(screen.getByText("2 feedings today · 1h 30m sleep · 1 diaper")).toBeTruthy();
  });

  it("hides what the user may not read and offers no logging without write access", () => {
    session.value = makeSession({
      canRead: (f) => f !== "pumping",
      canWrite: (f) => f === "diaper",
    });
    renderUi();
    expect(screen.queryByText("Pumping", { selector: ".simple-row-title" })).toBeNull();
    expect(within(row("Diaper")).getByRole("button", { name: "Log Diaper" })).toBeTruthy();
    expect(within(row("Feeding")).queryByRole("button", { name: "Log Feeding" })).toBeNull();
    expect(row("Feeding").querySelector(".simple-row-main").disabled).toBe(true);
  });

  it("saves a diaper in one tap and can undo it", async () => {
    api.createChange.mockResolvedValue({ id: 99 });
    renderUi();
    fireEvent.click(within(row("Diaper")).getByRole("button", { name: "Log Diaper" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Wet" }));

    await waitFor(() => expect(api.createChange).toHaveBeenCalledTimes(1));
    expect(api.createChange).toHaveBeenCalledWith({
      child: 7,
      time: NOW.toISOString().slice(0, 19),
      wet: true,
      solid: false,
    });
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(session.value.data.refetch).toHaveBeenCalled();

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(session.value.deleteEntry).toHaveBeenCalledWith("diaper", 99);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("logs a bottle with the last amount as the starting point", async () => {
    api.createFeeding.mockResolvedValue({ id: 50 });
    renderUi();
    fireEvent.click(within(row("Feeding")).getByRole("button", { name: "Log Feeding" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("120 mL")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "More" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "15 min ago" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledTimes(1));
    const end = new Date(NOW.getTime() - 15 * 60000);
    expect(api.createFeeding).toHaveBeenCalledWith({
      child: 7,
      type: "breast milk",
      method: "bottle",
      amount: 130,
      start: new Date(end.getTime() - 15 * 60000).toISOString().slice(0, 19),
      end: end.toISOString().slice(0, 19),
    });
  });

  it("sends no amount for a breastfeed", async () => {
    api.createFeeding.mockResolvedValue({ id: 51 });
    renderUi();
    fireEvent.click(within(row("Feeding")).getByRole("button", { name: "Log Feeding" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Left Breast" }));
    expect(within(dialog).queryByText("120 mL")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createFeeding).toHaveBeenCalledTimes(1));
    expect(api.createFeeding.mock.calls[0][0]).not.toHaveProperty("amount");
    expect(api.createFeeding.mock.calls[0][0].method).toBe("left breast");
  });

  it("keeps the sheet open with a message when saving fails", async () => {
    api.createChange.mockRejectedValue(new Error("offline"));
    renderUi();
    fireEvent.click(within(row("Diaper")).getByRole("button", { name: "Log Diaper" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Wet" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(session.value.data.refetch).not.toHaveBeenCalled();
  });

  it("starts a sleep timer from the sleep sheet", async () => {
    renderUi();
    fireEvent.click(within(row("Sleep")).getByRole("button", { name: "Log Sleep" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start sleep now" }));
    await waitFor(() => expect(session.value.timer.startTimer).toHaveBeenCalledWith("sleep"));
    expect(await screen.findByText("Timer started")).toBeTruthy();
  });

  it("logs a past sleep that crossed midnight as night sleep", async () => {
    api.createSleep.mockResolvedValue({ id: 60 });
    renderUi();
    fireEvent.click(within(row("Sleep")).getByRole("button", { name: "Log Sleep" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Fell asleep"), { target: { value: "21:30" } });
    fireEvent.change(within(dialog).getByLabelText("Woke up"), { target: { value: "06:15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createSleep).toHaveBeenCalledTimes(1));
    expect(api.createSleep).toHaveBeenCalledWith({
      child: 7,
      start: new Date(2026, 9, 21, 21, 30).toISOString().slice(0, 19),
      end: new Date(2026, 9, 22, 6, 15).toISOString().slice(0, 19),
      nap: false,
    });
  });

  it("wakes a sleeping baby from the row: stops the timer and saves the sleep", async () => {
    const running = { id: 31, name: "Sleep", start: new Date(NOW.getTime() - 50 * 60000), childId: 7, pauses: [] };
    session.value = makeSession();
    session.value.timer.activeTimers = [running];
    session.value.timer.elapsedMap = { 31: 3000 };
    session.value.timer.stopTimer.mockResolvedValue({ ...running });
    api.createSleep.mockResolvedValue({ id: 61 });
    renderUi();

    expect(within(row("Sleep")).getByText("Asleep for 50:00")).toBeTruthy();
    fireEvent.click(within(row("Sleep")).getByRole("button", { name: "Wake up" }));
    await waitFor(() => expect(api.createSleep).toHaveBeenCalledTimes(1));
    expect(session.value.timer.stopTimer).toHaveBeenCalledWith(31);
    expect(api.createSleep).toHaveBeenCalledWith({
      child: 7,
      timer: 31,
      end: NOW.toISOString().slice(0, 19),
      nap: true,
    });
  });

  it("puts the timer back when saving it fails", async () => {
    const running = { id: 31, name: "Sleep", start: new Date(NOW.getTime() - 50 * 60000), childId: 7, pauses: [] };
    session.value = makeSession();
    session.value.timer.activeTimers = [running];
    session.value.timer.stopTimer.mockResolvedValue({ ...running });
    api.createSleep.mockRejectedValue(new Error("offline"));
    renderUi();
    fireEvent.click(within(row("Sleep")).getByRole("button", { name: "Wake up" }));
    await waitFor(() => expect(session.value.timer.resumeTimer).toHaveBeenCalledWith(31));
    expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  });

  it("ignores another child's timer", () => {
    session.value = makeSession();
    session.value.timer.activeTimers = [{ id: 40, name: "Sleep", start: new Date(), childId: 8, pauses: [] }];
    renderUi();
    expect(within(row("Sleep")).queryByRole("button", { name: "Wake up" })).toBeNull();
  });

  it("hands over to the full form from More options", () => {
    renderUi();
    fireEvent.click(within(row("Pumping")).getByRole("button", { name: "Log Pumping" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "More options" }));
    expect(screen.getByText("full form: pumping")).toBeTruthy();
  });
});
