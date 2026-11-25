// The UIs this build ships. Each is a folder under uis/ whose component draws
// the signed-in app from useSession() (core/session.jsx). They are loaded on
// demand, so a browser only downloads the one in use.
//
// To add a UI: create uis/<id>/ with a default-exported component and add an
// entry here, with a `labelKey` translation for the pickers in Settings.
export const UIS = {
  full: { labelKey: "ui.full", load: () => import("./full/FullUI") },
  simple: { labelKey: "ui.simple", load: () => import("./simple/SimpleUI") },
  timeline: { labelKey: "ui.timeline", load: () => import("./timeline/TimelineUI") },
};

export const DEFAULT_UI = "full";

export function isKnownUi(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(UIS, id);
}

// resolveUi picks the UI to show from choices in priority order — this
// device's override first, then the account's setting, then the default an
// admin set for the installation — skipping any that are empty or unknown (a
// UI removed in a later version, a hand-edited value), and falls back to the
// default instead of leaving a blank screen.
export function resolveUi(...choices) {
  return choices.find(isKnownUi) || DEFAULT_UI;
}
