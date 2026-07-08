import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import InstallPrompt from "./InstallPrompt";
import { I18nProvider } from "../utils/i18n";

afterEach(cleanup);

function renderInstallPrompt() {
  return render(
    <I18nProvider>
      <InstallPrompt />
    </I18nProvider>,
  );
}

describe("InstallPrompt dismissal persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("does not show prompt after dismissal on page reload", () => {
    localStorage.setItem("babytracker_install_prompt_dismissed", "1");

    renderInstallPrompt();

    // Dispatch after render — component is already listening
    window.dispatchEvent(new Event("beforeinstallprompt"));

    expect(screen.queryByRole("alert", { name: "Install app banner" })).toBeNull();
  });

  it("shows prompt on fresh page load when not dismissed", async () => {
    renderInstallPrompt();

    // Dispatch after render
    window.dispatchEvent(new Event("beforeinstallprompt"));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Install app banner" })).toBeTruthy();
    });
  });

  it("persists dismissal after user clicks dismiss", async () => {
    renderInstallPrompt();

    window.dispatchEvent(new Event("beforeinstallprompt"));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Install app banner" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert", { name: "Install app banner" })).toBeNull();
    expect(localStorage.getItem("babytracker_install_prompt_dismissed")).toBe("1");
  });
});