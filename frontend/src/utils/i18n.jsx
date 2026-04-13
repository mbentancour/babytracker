import { createContext, useContext, useState, useCallback } from "react";

// Default English translations
const en = {
  // Navigation
  "nav.overview": "Overview",
  "nav.growth": "Growth",
  "nav.notes": "Notes",
  "nav.milestones": "Milestones",

  // Actions
  "action.track": "Track",
  "action.measure": "Measure",
  "action.note": "Note",
  "action.more": "More",
  "action.feeding": "Feeding",
  "action.sleep": "Sleep",
  "action.diaper": "Diaper",
  "action.tummy": "Tummy",
  "action.temp": "Temp",
  "action.weight": "Weight",
  "action.height": "Height",
  "action.headCirc": "Head",
  "action.medication": "Meds",
  "action.milestone": "Milestone",

  // Forms
  "form.save": "Save",
  "form.saving": "Saving...",
  "form.update": "Update",
  "form.cancel": "Cancel",
  "form.delete": "Delete",
  "form.optional": "Optional",

  // Auth
  "auth.signIn": "Sign In",
  "auth.createAccount": "Create Account",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm Password",

  // General
  "general.loading": "Loading...",
  "general.connectionError": "Connection error",
  "general.noData": "No data yet",
};

const translations = { en };

const I18nContext = createContext({ t: (key) => key, locale: "en", setLocale: () => {} });

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(
    () => localStorage.getItem("babytracker_locale") || "en"
  );

  const t = useCallback(
    (key, params = {}) => {
      const dict = translations[locale] || translations.en;
      let text = dict[key] || translations.en[key] || key;
      // Simple template replacement: {{name}} -> value
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

// Register additional translation dictionaries
export function registerTranslations(locale, dict) {
  translations[locale] = { ...translations.en, ...dict };
}

export { translations };
