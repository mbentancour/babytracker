import { lazy, Suspense } from "react";
import { UIS, resolveUi, isKnownUi } from "../uis";
import { useSession } from "./session";
import { usePreferences } from "../utils/preferences";
import { useI18n } from "../utils/i18n";

// One lazy component per UI, created on first use and kept: React.lazy must
// get the same component on every render or it remounts the whole tree.
const loaded = {};
function uiComponent(id) {
  if (!loaded[id]) loaded[id] = lazy(UIS[id].load);
  return loaded[id];
}

// UiHost renders the UI for this user on this device: the device's own
// override (the `ui` preference) if it has one, otherwise the choice saved on
// the account, otherwise the default.
export default function UiHost() {
  const { t } = useI18n();
  const { prefs } = usePreferences();
  const { userUi, accountLoaded } = useSession();
  const loading = (
    <div className="app-loading">
      <div className="loading-spinner" />
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("general.loading")}</span>
    </div>
  );
  // Without a device override the account decides, so wait for it instead of
  // drawing the default UI and then swapping to another one.
  if (!isKnownUi(prefs.ui) && !accountLoaded) return loading;
  const Ui = uiComponent(resolveUi(prefs.ui, userUi));
  return (
    <Suspense fallback={loading}>
      <Ui />
    </Suspense>
  );
}
