import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "./utils/preferences";
import { I18nProvider } from "./utils/i18n";
import App from "./App";

// Apply theme as early as possible in the bundle to minimise the flash of
// wrong-theme paint. Lived in index.html as an inline <script> originally,
// but that violated the strict-mode CSP (script-src 'self' without
// unsafe-inline) and logged a console error on every load.
document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("babytracker_theme") || "system",
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </I18nProvider>
  </StrictMode>
);
