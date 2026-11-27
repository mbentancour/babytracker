import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "./utils/preferences";
import { I18nProvider } from "./utils/i18n";
import ErrorBoundary from "./components/ErrorBoundary";
import { watchFrameOffsets } from "./utils/frameOffset";
import App from "./App";

// Apply theme as early as possible in the bundle to minimise the flash of
// wrong-theme paint. Lived in index.html as an inline <script> originally,
// but that violated the strict-mode CSP (script-src 'self' without
// unsafe-inline) and logged a console error on every load.
document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("babytracker_theme") || "system",
);

// Inside Home Assistant the app is in a frame, below Home Assistant's own
// header and clear of the screen's edges. Tell the stylesheet where the frame
// is before anything is drawn, so the room for the phone's status bar and
// home bar is not left a second time.
watchFrameOffsets();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>
);
