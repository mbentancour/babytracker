// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

const session = vi.hoisted(() => ({ value: { userUi: "", accountLoaded: false } }));
vi.mock("./session", () => ({ useSession: () => session.value }));
vi.mock("../uis", async (orig) => {
  const real = await orig();
  // Two stand-in UIs so the choice between them is visible.
  const UIS = {
    full: { labelKey: "ui.full", load: async () => ({ default: () => <p>full ui</p> }) },
    other: { labelKey: "ui.full", load: async () => ({ default: () => <p>other ui</p> }) },
  };
  const isKnownUi = (id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(UIS, id);
  return { ...real, UIS, isKnownUi, resolveUi: (...c) => c.find(isKnownUi) || "full" };
});

import UiHost from "./UiHost";

const renderHost = () =>
  render(
    <I18nProvider>
      <PreferencesProvider>
        <UiHost />
      </PreferencesProvider>
    </I18nProvider>
  );

describe("UiHost", () => {
  beforeEach(() => {
    localStorage.clear();
    session.value = { userUi: "", accountLoaded: false };
  });
  afterEach(cleanup);

  it("waits for the account before choosing, so the wrong UI never flashes", async () => {
    renderHost();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("full ui")).toBeNull();
  });

  it("shows the account's UI once it is known", async () => {
    session.value = { userUi: "other", accountLoaded: true };
    renderHost();
    expect(await screen.findByText("other ui")).toBeTruthy();
  });

  it("shows the default when the account has no choice", async () => {
    session.value = { userUi: "", accountLoaded: true };
    renderHost();
    expect(await screen.findByText("full ui")).toBeTruthy();
  });

  it("lets this device override the account, without waiting for it", async () => {
    localStorage.setItem("babytracker_preferences", JSON.stringify({ ui: "other" }));
    session.value = { userUi: "full", accountLoaded: false };
    renderHost();
    expect(await screen.findByText("other ui")).toBeTruthy();
  });

  it("ignores a device override for a UI that no longer exists", async () => {
    localStorage.setItem("babytracker_preferences", JSON.stringify({ ui: "removed" }));
    session.value = { userUi: "other", accountLoaded: true };
    renderHost();
    expect(await screen.findByText("other ui")).toBeTruthy();
  });
});
