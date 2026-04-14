import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "./utils/preferences";
import { I18nProvider } from "./utils/i18n";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </I18nProvider>
  </StrictMode>
);
