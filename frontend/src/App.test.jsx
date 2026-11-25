// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import App from "./App";
import { I18nProvider } from "./utils/i18n";
import { PreferencesProvider } from "./utils/preferences";
import { api } from "./api";

// The whole signed-in path in demo mode: App reads the config, Session loads
// the (mock) data, UiHost picks the UI for this device, and that UI renders.
describe("App in demo mode", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, "getConfig").mockResolvedValue({ demo_mode: true, unit_system: "metric" });
    // jsdom has no EventSource; the picture frame listens on one.
    vi.stubGlobal("EventSource", class { close() {} });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderApp = () =>
    render(
      <I18nProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </I18nProvider>
    );

  it("loads the default UI with the session's data", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Emma" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("falls back to the default UI when the saved choice no longer exists", async () => {
    localStorage.setItem("babytracker_preferences", JSON.stringify({ ui: "removed-ui" }));
    renderApp();
    expect(await screen.findByRole("heading", { name: "Emma" }, { timeout: 5000 })).toBeTruthy();
  });

  it("opens an entry form from the UI through the shared modal host", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Emma" }, { timeout: 5000 });
    const feedingCard = (await screen.findAllByRole("button", { name: "Feeding" }))[0];
    fireEvent.click(feedingCard);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Log Feeding")).toBeTruthy();
  });
});
