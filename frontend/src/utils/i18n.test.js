import { createElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider, useI18n } from "./i18n";
import { describe, it, expect } from "vitest";
import { translations, AVAILABLE_LANGUAGES, interpolate, detectBrowserLocale } from "./i18n";

describe("interpolate", () => {
  it("fills every occurrence of a placeholder", () => {
    expect(interpolate("{{n}} of {{n}}", { n: 2 })).toBe("2 of 2");
  });

  // Values can come from an imported file, so they're inserted as is.
  it("doesn't expand placeholders or replacement patterns inside values", () => {
    const params = { line: 7, type: "{{reason}}", reason: "costs $& and $1" };
    expect(interpolate("Line {{line}} ({{type}}): {{reason}}", params)).toBe("Line 7 ({{reason}}): costs $& and $1");
  });

  it("leaves a placeholder without a param alone", () => {
    expect(interpolate("{{count}} {{toString}}", {})).toBe("{{count}} {{toString}}");
  });
});

// English is the source language and the runtime fallback (t() falls back to
// translations.en[key]). Any key present in en but missing from es/da renders
// as English to that user — the exact class of gap this suite guards against.
describe("i18n translation parity", () => {
  const en = translations.en;
  const enKeys = Object.keys(en);

  it("has a non-trivial English base", () => {
    expect(enKeys.length).toBeGreaterThan(100);
  });

  for (const locale of Object.keys(translations)) {
    if (locale === "en") continue;

    it(`${locale}: has no keys missing from English (dead keys)`, () => {
      const extra = Object.keys(translations[locale]).filter((k) => !(k in en));
      expect(extra).toEqual([]);
    });

    it(`${locale}: covers every English key`, () => {
      const missing = enKeys.filter((k) => !(k in translations[locale]));
      expect(missing).toEqual([]);
    });

    it(`${locale}: has no empty translations`, () => {
      const blank = Object.entries(translations[locale])
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    // t() substitutes by name, so a placeholder dropped or mistyped in a
    // translation doesn't fall back to English — it renders the literal
    // "{{count}}" to that user, or silently loses the number entirely.
    it(`${locale}: keeps every interpolation placeholder`, () => {
      const placeholders = (s) =>
        (typeof s === "string" ? s.match(/\{\{[^}]+\}\}/g) || [] : []).sort();

      const mismatched = enKeys
        .filter((k) => k in translations[locale])
        .map((k) => ({
          key: k,
          en: placeholders(en[k]),
          translated: placeholders(translations[locale][k]),
        }))
        .filter((r) => r.en.join(",") !== r.translated.join(","))
        .map((r) => `${r.key}: expected [${r.en}], got [${r.translated}]`);

      expect(mismatched).toEqual([]);
    });
  }

  it("every advertised language has a translation table", () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(translations[lang.code]).toBeDefined();
    }
  });
});


describe("browser locale detection", () => {
  it("matches regional language tags case-insensitively before the base language", () => {
    expect(detectBrowserLocale(["PT-pt"], null)).toBe("pt-PT");
    expect(detectBrowserLocale(["fr-CA"], null)).toBe("fr");
    expect(detectBrowserLocale(["zz", "pt-PT"], null)).toBe("pt-PT");
    expect(detectBrowserLocale(["zz"], null)).toBe("en");
    expect(detectBrowserLocale(["pt-PT"], "fr")).toBe("fr");
  });
});


describe("European Portuguese", () => {
  it("registers the regional dictionary and picker option", () => {
    expect(AVAILABLE_LANGUAGES.find((l) => l.code === "pt-PT")?.label).toBe("Português (Portugal)");
    expect(translations["pt-PT"]["auth.password"]).toBe("Palavra-passe");
    expect(detectBrowserLocale(["pt-BR"], null)).toBe("en");
    expect(detectBrowserLocale(["en-US", "pt-PT"], null)).toBe("en");
  });

  it("preserves single-brace markers and line breaks used by settings", () => {
    for (const [key, value] of Object.entries(translations.en)) {
      const markers = (s) => (s.match(/\{\w+\}/g) || []).sort();
      expect(markers(translations["pt-PT"][key]), key).toEqual(markers(value));
      expect(translations["pt-PT"][key].split("\n").length, key).toBe(value.split("\n").length);
    }
  });

  it("provides both plural forms with their count", () => {
    for (const key of Object.keys(translations.en).filter((k) => k.endsWith("_one"))) {
      const other = key.replace(/_one$/, "_other");
      expect(translations["pt-PT"][other]).toBeTruthy();
      expect(interpolate(translations["pt-PT"][other], { count: 2 })).not.toContain("{{count}}");
    }
  });

  it("persists selection across remounts and retains English/key fallback", () => {
    function Probe() {
      const { t, locale, setLocale } = useI18n();
      return createElement("button", { onClick: () => setLocale("pt-PT") }, locale + ":" + t("auth.password") + ":" + t("unknown.key"));
    }
    localStorage.setItem("babytracker_locale", "en");
    try {
      render(createElement(I18nProvider, null, createElement(Probe)));
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("button").textContent).toBe("pt-PT:Palavra-passe:unknown.key");
      expect(localStorage.getItem("babytracker_locale")).toBe("pt-PT");
      cleanup();
      render(createElement(I18nProvider, null, createElement(Probe)));
      expect(screen.getByRole("button").textContent).toContain("pt-PT:Palavra-passe");
      cleanup();
      localStorage.setItem("babytracker_locale", "unsupported");
      render(createElement(I18nProvider, null, createElement(Probe)));
      expect(screen.getByRole("button").textContent).toBe("unsupported:Password:unknown.key");
    } finally {
      cleanup();
      localStorage.removeItem("babytracker_locale");
    }
  });
});
