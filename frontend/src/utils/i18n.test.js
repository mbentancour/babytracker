import { describe, it, expect } from "vitest";
import { translations, AVAILABLE_LANGUAGES } from "./i18n";

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
  }

  it("every advertised language has a translation table", () => {
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(translations[lang.code]).toBeDefined();
    }
  });
});
