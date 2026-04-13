import { createContext, useContext, useState, useCallback } from "react";

const STORAGE_KEY = "babytracker_preferences";

const DEFAULT_PREFERENCES = {
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
        autoCalculateBMI: parsed.autoCalculateBMI ?? DEFAULT_PREFERENCES.autoCalculateBMI,
        pictureFrameTimeout: parsed.pictureFrameTimeout ?? DEFAULT_PREFERENCES.pictureFrameTimeout,
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

// Feature metadata for the settings UI
export const FEATURE_LIST = [
  { id: "feeding", label: "Feedings", description: "Track breast milk, formula, solids" },
  { id: "sleep", label: "Sleep", description: "Track sleep and nap times" },
  { id: "diaper", label: "Diaper Changes", description: "Track wet and solid diapers" },
  { id: "tummy", label: "Tummy Time", description: "Track tummy time sessions" },
  { id: "temp", label: "Temperature", description: "Record temperature readings" },
  { id: "weight", label: "Weight", description: "Track weight measurements" },
  { id: "height", label: "Height", description: "Track height/length measurements" },
  { id: "headcirc", label: "Head Circumference", description: "Track head growth" },
  { id: "pumping", label: "Pumping", description: "Track breast milk pumping" },
  { id: "bmi", label: "BMI", description: "Track body mass index" },
  { id: "medication", label: "Medications", description: "Track medications and vitamins" },
  { id: "milestone", label: "Milestones", description: "Record developmental milestones" },
  { id: "note", label: "Notes", description: "General notes and observations" },
];

export const FEEDING_TYPES = [
  { value: "breast milk", label: "Breast Milk" },
  { value: "formula", label: "Formula" },
  { value: "fortified breast milk", label: "Fortified Breast Milk" },
  { value: "solid food", label: "Solid Food" },
];

export const FEEDING_METHODS = [
  { value: "bottle", label: "Bottle" },
  { value: "left breast", label: "Left Breast" },
  { value: "right breast", label: "Right Breast" },
  { value: "both breasts", label: "Both Breasts" },
  { value: "parent fed", label: "Parent Fed" },
  { value: "self fed", label: "Self Fed" },
];
