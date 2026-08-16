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

  // Optional views. Kept separate from `features` above because those ids are
  // also the RBAC feature namespace (App.jsx's TABS pass them to canRead), and
  // these are presentation-only — there is no server-side "day" permission.
  //
  // Day and Routine default on, matching the convention that features ship
  // enabled. Milk stock defaults off: it adds a new logging action and only
  // means anything if you both pump and store, so it's opt-in.
  views: {
    day: true,
    routine: true,
    milkStock: false,
  },

  // How many days the Routine view plots. A week is too short to read a trend
  // off — the point of that view is spotting a rhythm shifting, which needs
  // several weeks of context.
  routineDays: 14,

  // Activity types hidden on the Routine plot. Empty means show everything —
  // the chips narrow the view rather than building it up.
  routineHidden: [],

  // Auto-calculate BMI from weight/height when no manual entry exists for a date
  autoCalculateBMI: true,

  // Full-screen photo resolution (picture frame + gallery lightbox).
  // "auto" picks a server rendition from the device's screen; "medium"/"large"
  // force that rendition; "original" disables resizing. Per-device by nature
  // (localStorage), so a weak tablet can be capped without affecting others.
  photoQuality: "auto",

  // Picture frame screensaver (0 = disabled, value in minutes)
  pictureFrameTimeout: 0,

  // Picture frame content filters (only types that support photos)
  pictureFrame: {
    slideDuration: 8, // seconds each photo is shown before advancing
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
      fontScale: 1,         // text + icon size multiplier (1 = default 14px)
      color: "#ffffff",     // text color
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
        views: { ...DEFAULT_PREFERENCES.views, ...parsed.views },
        theme: parsed.theme ?? DEFAULT_PREFERENCES.theme,
        routineDays: parsed.routineDays ?? DEFAULT_PREFERENCES.routineDays,
        routineHidden: parsed.routineHidden ?? DEFAULT_PREFERENCES.routineHidden,
        autoCalculateBMI: parsed.autoCalculateBMI ?? DEFAULT_PREFERENCES.autoCalculateBMI,
        photoQuality: parsed.photoQuality ?? DEFAULT_PREFERENCES.photoQuality,
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
  setViewEnabled: () => {},
  setFormDefault: () => {},
  isFeatureEnabled: () => true,
  isViewEnabled: () => false,
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

  const setViewEnabled = useCallback((view, enabled) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        views: { ...prev.views, [view]: enabled },
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

  // Unlike isFeatureEnabled, an unknown view reads as disabled: views are
  // opt-in surfaces, and a typo should hide one rather than silently show it.
  const isViewEnabled = useCallback(
    (view) => prefs.views?.[view] === true,
    [prefs.views]
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
    <PreferencesContext.Provider value={{ prefs, setFeatureEnabled, setViewEnabled, setFormDefault, isFeatureEnabled, isViewEnabled, getFormDefault, setPref }}>
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

// Optional-view metadata for the settings UI, mirroring FEATURE_LIST.
// Periods offered by the Routine view. 7 days barely shows a rhythm; 30 is
// where a drift in bedtime or a lengthening night becomes obvious.
export const ROUTINE_PERIODS = [7, 14, 30];

export const VIEW_LIST = [
  { id: "day", labelKey: "view.day", descKey: "view.dayDesc" },
  { id: "routine", labelKey: "view.routine", descKey: "view.routineDesc" },
  { id: "milkStock", labelKey: "view.milkStock", descKey: "view.milkStockDesc" },
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

// The feeding types that come out of the expressed-milk stash. Fortified
// breast milk counts because its base is thawed expressed milk; formula and
// solids never came from the stash. Must stay in step with the type filter in
// models.GetMilkStock, or the chart and the headline balance disagree.
export const BREAST_MILK_TYPES = ["breast milk", "fortified breast milk"];

// The subset of FEEDING_METHODS that is nursing at the breast. These are timed
// rather than measured, so duration is the meaningful number for them — every
// other method either records an amount or isn't a milk feed at all. Values
// match the CHECK constraint on feedings.method.
export const BREAST_METHODS = ["left breast", "right breast", "both breasts"];
