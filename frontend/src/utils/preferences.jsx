import { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "babytracker_preferences";

const DEFAULT_PREFERENCES = {
  // Theme: "system", "light", "dark"
  theme: "system",

  // Feature toggles - all enabled by default
  features: {
    feeding: true,
    sleep: true,
    diaper: true,
    tummy: true,
    temp: true,
    weight: true,
    height: true,
    headcirc: true,
    pumping: true,
    bmi: true,
    medication: true,
    milestone: true,
    note: true,
  },

  // Auto-calculate BMI from weight/height when no manual entry exists for a date
  autoCalculateBMI: true,

  // Picture frame screensaver (0 = disabled, value in minutes)
  pictureFrameTimeout: 0,

  // Picture frame content filters (only types that support photos)
  pictureFrame: {
    showShared: true,
    showProfile: true,
    showPhoto: true,
    showMilestone: true,
    showWeight: true,
    showHeight: true,
    showHeadCirc: false,
    showTemp: false,
    showMedication: false,
    showNote: false,
    childIds: [], // empty = all children
    // Live status overlay items — shown discretely at the bottom of the slideshow
    overlay: {
      timers: false,        // active timers (live tick)
      lastFeeding: false,   // time since last feeding
      lastSleep: false,     // time since last sleep
      lastDiaper: false,    // time since last diaper change
      currentTime: false,   // wall clock
    },
  },

  // Form defaults
  defaults: {
    feeding: {
      type: "breast milk",
      method: "bottle",
    },
    diaper: {
      color: "",
    },
    medication: {
      dosage_unit: "ml",
    },
  },
};

function loadPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Deep merge with defaults to handle new fields
      return {
        features: { ...DEFAULT_PREFERENCES.features, ...parsed.features },
        theme: parsed.theme ?? DEFAULT_PREFERENCES.theme,
        autoCalculateBMI: parsed.autoCalculateBMI ?? DEFAULT_PREFERENCES.autoCalculateBMI,
        pictureFrameTimeout: parsed.pictureFrameTimeout ?? DEFAULT_PREFERENCES.pictureFrameTimeout,
        pictureFrame: {
          ...DEFAULT_PREFERENCES.pictureFrame,
          ...parsed.pictureFrame,
          overlay: { ...DEFAULT_PREFERENCES.pictureFrame.overlay, ...parsed.pictureFrame?.overlay },
        },
        defaults: {
          feeding: { ...DEFAULT_PREFERENCES.defaults.feeding, ...parsed.defaults?.feeding },
          diaper: { ...DEFAULT_PREFERENCES.defaults.diaper, ...parsed.defaults?.diaper },
          medication: { ...DEFAULT_PREFERENCES.defaults.medication, ...parsed.defaults?.medication },
        },
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_PREFERENCES;
}

function savePreferences(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const PreferencesContext = createContext({
  prefs: DEFAULT_PREFERENCES,
  setFeatureEnabled: () => {},
  setFormDefault: () => {},
  isFeatureEnabled: () => true,
  getFormDefault: () => undefined,
});

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(loadPreferences);

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    const theme = prefs.theme || "system";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("babytracker_theme", theme);
  }, [prefs.theme]);

  const setFeatureEnabled = useCallback((feature, enabled) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        features: { ...prev.features, [feature]: enabled },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const setFormDefault = useCallback((formType, field, value) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        defaults: {
          ...prev.defaults,
          [formType]: { ...prev.defaults[formType], [field]: value },
        },
      };
      savePreferences(next);
      return next;
    });
  }, []);

  const isFeatureEnabled = useCallback(
    (feature) => prefs.features[feature] !== false,
    [prefs.features]
  );

  const getFormDefault = useCallback(
    (formType, field) => prefs.defaults[formType]?.[field],
    [prefs.defaults]
  );

  const setPref = useCallback((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      savePreferences(next);
      return next;
    });
  }, []);

  return (
    <PreferencesContext.Provider value={{ prefs, setFeatureEnabled, setFormDefault, isFeatureEnabled, getFormDefault, setPref }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}

// Feature metadata for the settings UI — labels/descriptions are i18n keys
export const FEATURE_LIST = [
  { id: "feeding", labelKey: "feature.feeding", descKey: "feature.feedingDesc" },
  { id: "sleep", labelKey: "feature.sleep", descKey: "feature.sleepDesc" },
  { id: "diaper", labelKey: "feature.diaper", descKey: "feature.diaperDesc" },
  { id: "tummy", labelKey: "feature.tummy", descKey: "feature.tummyDesc" },
  { id: "temp", labelKey: "feature.temp", descKey: "feature.tempDesc" },
  { id: "weight", labelKey: "feature.weight", descKey: "feature.weightDesc" },
  { id: "height", labelKey: "feature.height", descKey: "feature.heightDesc" },
  { id: "headcirc", labelKey: "feature.headcirc", descKey: "feature.headcircDesc" },
  { id: "pumping", labelKey: "feature.pumping", descKey: "feature.pumpingDesc" },
  { id: "bmi", labelKey: "feature.bmi", descKey: "feature.bmiDesc" },
  { id: "medication", labelKey: "feature.medication", descKey: "feature.medicationDesc" },
  { id: "milestone", labelKey: "feature.milestone", descKey: "feature.milestoneDesc" },
  { id: "note", labelKey: "feature.note", descKey: "feature.noteDesc" },
];

// These use i18n keys — translate with t() at render time
export const FEEDING_TYPES = [
  { value: "breast milk", labelKey: "feeding.breastMilk" },
  { value: "formula", labelKey: "feeding.formula" },
  { value: "fortified breast milk", labelKey: "feeding.fortified" },
  { value: "solid food", labelKey: "feeding.solidFood" },
];

export const FEEDING_METHODS = [
  { value: "bottle", labelKey: "feeding.bottle" },
  { value: "left breast", labelKey: "feeding.leftBreast" },
  { value: "right breast", labelKey: "feeding.rightBreast" },
  { value: "both breasts", labelKey: "feeding.bothBreasts" },
  { value: "parent fed", labelKey: "feeding.parentFed" },
  { value: "self fed", labelKey: "feeding.selfFed" },
];
