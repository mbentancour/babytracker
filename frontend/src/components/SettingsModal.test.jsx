import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

// Every api call answers with an empty object; Settings' sections cope.
vi.mock("../api", () => ({
  api: new Proxy({}, { get: (_, name) => (name === "then" ? undefined : () => Promise.resolve({})) }),
}));

const { default: SettingsModal, NaraImportDialog } = await import("./SettingsModal");

// jsdom has no layout, so offsetParent is always null, and the Tab trap
// (which skips controls that aren't rendered by that) would see none.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent));
afterEach(cleanup);

const tab = (shiftKey = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey });

describe("NaraImportDialog", () => {
  it("takes focus, keeps Tab inside, and gives focus back to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <>
        <button>Behind</button>
        <NaraImportDialog label="Import from Nara Baby" opener={{ current: opener }}>
          <h1 tabIndex={-1}>Import Complete!</h1>
          <input type="file" aria-label="File" />
          <button>Back</button>
        </NaraImportDialog>
      </>,
    );
    const file = screen.getByLabelText("File");
    const back = screen.getByRole("button", { name: "Back" });
    expect(screen.getByRole("dialog", { name: "Import from Nara Baby" })).toBeTruthy();
    expect(document.activeElement).toBe(file);

    tab(true); // Shift+Tab from the first control wraps to the last...
    expect(document.activeElement).toBe(back);
    tab(); // ...and Tab from the last to the first.
    expect(document.activeElement).toBe(file);

    // Focus that got out, to the page behind or to <body> when the focused
    // control was disabled, comes back in.
    screen.getByRole("button", { name: "Behind" }).focus();
    tab();
    expect(document.activeElement).toBe(file);
    document.activeElement.blur();
    tab(true);
    expect(document.activeElement).toBe(back);

    // So does Shift+Tab from a focused heading above the first control.
    screen.getByRole("heading").focus();
    tab(true);
    expect(document.activeElement).toBe(back);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("opens from Settings → Data over an inert page, without a unit choice", async () => {
    const onUnitSystemChange = vi.fn();
    render(
      <I18nProvider>
        <PreferencesProvider>
          <SettingsModal isAdmin unitSystem="metric" onUnitSystemChange={onUnitSystemChange} children={[{ id: 1, first_name: "Ana" }]} onClose={() => {}} />
        </PreferencesProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    const opener = await screen.findByRole("button", { name: "Import from Nara Baby" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Import from Nara Baby" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.querySelector(".settings-page").hasAttribute("inert")).toBe(true);
    // Ana's amounts are labelled with this device's units, so a second baby
    // is saved in them too rather than switching the device.
    expect(screen.queryByLabelText("Save amounts in")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector(".settings-page").hasAttribute("inert")).toBe(false);
    expect(onUnitSystemChange).not.toHaveBeenCalled();
  });

  it("holds focus itself while every control is disabled", () => {
    render(
      <NaraImportDialog label="Import from Nara Baby" opener={{ current: null }}>
        <button disabled>Importing...</button>
      </NaraImportDialog>,
    );
    tab();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
});
