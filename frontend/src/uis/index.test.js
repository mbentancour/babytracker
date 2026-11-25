import { describe, it, expect } from "vitest";
import { UIS, DEFAULT_UI, resolveUi, isKnownUi } from "./index";
import { translations } from "../utils/i18n";

describe("UI registry", () => {
  it("ships the default UI", () => {
    expect(isKnownUi(DEFAULT_UI)).toBe(true);
  });

  it("every UI has a translated name and loads a component", async () => {
    for (const ui of Object.values(UIS)) {
      expect(translations.en[ui.labelKey], ui.labelKey).toBeTruthy();
      const mod = await ui.load();
      expect(typeof mod.default).toBe("function");
    }
  });

  it("only its own ids are known", () => {
    expect(isKnownUi("")).toBe(false);
    expect(isKnownUi(undefined)).toBe(false);
    expect(isKnownUi("toString")).toBe(false);
    expect(isKnownUi("gone-in-a-later-version")).toBe(false);
  });
});

describe("resolveUi", () => {
  it("prefers the device's override over the account's choice", () => {
    expect(resolveUi("full", "")).toBe("full");
    expect(resolveUi("full", "something-else")).toBe("full");
  });

  it("uses the account's choice when the device has none", () => {
    expect(resolveUi("", "full")).toBe("full");
    expect(resolveUi(undefined, "full")).toBe("full");
  });

  it("skips unknown ids instead of showing nothing", () => {
    expect(resolveUi("removed-ui", "full")).toBe("full");
    expect(resolveUi("removed-ui", "also-removed")).toBe(DEFAULT_UI);
  });

  it("falls back to the default with no choices at all", () => {
    expect(resolveUi()).toBe(DEFAULT_UI);
    expect(resolveUi("", "")).toBe(DEFAULT_UI);
  });
});
