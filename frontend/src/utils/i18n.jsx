import { createContext, useContext, useState, useCallback } from "react";
import en from "../locales/en";
import es from "../locales/es";
import da from "../locales/da";
import fr from "../locales/fr";
import it from "../locales/it";
import de from "../locales/de";
import { setDisplayLocale } from "./formatters";

const translations = { en, es, da, fr, it, de };

// A language must appear here as well as in `translations` to show up in the
// picker — registerTranslations() below only touches the latter, so a locale
// added that way is reachable by code but invisible in Settings.
const AVAILABLE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "da", label: "Dansk" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
];

function detectBrowserLocale() {
  const stored = localStorage.getItem("babytracker_locale");
  if (stored) return stored;
  // Match browser language to available translations
  const browserLangs = navigator.languages || [navigator.language];
  for (const lang of browserLangs) {
    const code = lang.split("-")[0].toLowerCase();
    if (translations[code]) return code;
  }
  return "en";
}

const I18nContext = createContext({ t: (key) => key, locale: "en", setLocale: () => {} });

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(detectBrowserLocale);

  // Dates and times go through Intl, which takes a locale tag rather than a
  // translated string, so the picked language has to be handed to it
  // separately. Set during render rather than in an effect: children render
  // immediately after this line, and a frame of dates in the previous language
  // is exactly the flicker this avoids.
  setDisplayLocale(locale);

  const t = useCallback(
    (key, params = {}) => {
      const dict = translations[locale] || translations.en;
      let text = dict[key] || translations.en[key] || key;
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{{${k}}}`, v);
      }
      return text;
    },
    [locale]
  );

  const changeLocale = useCallback((newLocale) => {
    setLocale(newLocale);
    localStorage.setItem("babytracker_locale", newLocale);
  }, []);

  return (
    <I18nContext.Provider value={{ t, locale, setLocale: changeLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function registerTranslations(locale, dict) {
  translations[locale] = { ...translations.en, ...dict };
}

export { translations, AVAILABLE_LANGUAGES };
