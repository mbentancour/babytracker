import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useBabyData } from "../hooks/useBabyData";
import { useTimers } from "../hooks/useTimers";
import { UnitContext } from "../utils/units";
import { api } from "../api";
import { usePreferences } from "../utils/preferences";
import { useI18n } from "../utils/i18n";
import OnboardingScreen from "../components/OnboardingScreen";
import { usePictureFrame } from "./usePictureFrame";
const PictureFrame = lazy(() => import("../components/PictureFrame"));

// Everything a signed-in UI needs that is not presentation: who the user is
// and what they may do, the selected child's data, the timers, and deleting
// entries. A UI reads it with useSession() and only has to draw screens.
const SessionContext = createContext(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <Session>");
  return session;
}

// Session loads the signed-in state and renders `children` (the chosen UI)
// once there is something to show. Until then it shows the loading screen, the
// first-child onboarding, or the "no access yet" notice itself, so no UI has
// to reimplement them.
export default function Session({ demoMode, applianceMode, onLogout, setupIntent, onSetupIntentConsumed, children }) {
  const { t: tr } = useI18n();
  const { isViewEnabled, prefs } = usePreferences();
  const [isAdmin, setIsAdmin] = useState(demoMode);
  const [userAccess, setUserAccess] = useState([]);
  // Which dialog is open (see useAppModal). Kept here rather than in a UI so
  // it survives switching UI: changing the interface in Settings must not
  // close Settings.
  const [modal, setModal] = useState(null);
  // The UI saved on the account ("" = default). A device can override it.
  const [userUi, setUserUiState] = useState("");
  // The UI an admin set for every account without a choice of its own ("" =
  // none set; the build's own default applies).
  const [defaultUi, setDefaultUiState] = useState("");
  const [selectedChildId, setSelectedChildId] = useState(null);

  const [permissionsLoaded, setPermissionsLoaded] = useState(demoMode);
  useEffect(() => {
    if (demoMode) { setPermissionsLoaded(true); return; }
    api.getCurrentUserAccess()
      .then((res) => {
        setIsAdmin(res.is_admin);
        setUserAccess(res.access || []);
        setUserUiState(res.ui || "");
        setDefaultUiState(res.default_ui || "");
        setPermissionsLoaded(true);
      })
      .catch(() => setPermissionsLoaded(true));
  }, [demoMode]);

  // Permission helpers — use selectedChildId to avoid circular dep with data.child
  const getPermission = useCallback((feature) => {
    if (demoMode || isAdmin) return "write";
    if (!selectedChildId) return "none";
    const access = userAccess.find((a) => a.child_id === selectedChildId);
    if (!access) return "none";
    const perm = access.permissions?.find((p) => p.feature === feature);
    return perm?.access_level || "none";
  }, [demoMode, isAdmin, userAccess, selectedChildId]);

  const canWrite = useCallback((feature) => getPermission(feature) === "write", [getPermission]);
  const canRead = useCallback((feature) => getPermission(feature) !== "none", [getPermission]);
  const hasAnyWriteAccess = demoMode || isAdmin || userAccess.some((a) =>
    a.permissions?.some((p) => p.access_level === "write")
  );

  // Data fetching — canRead is now defined before this call
  const data = useBabyData(canRead, { milkStockEnabled: isViewEnabled("milkStock") });
  const timer = useTimers(data.timers, data.child?.id);
  // True while an onboarding import's summary is on screen: the import has
  // already created the child, and the next background refresh would
  // otherwise switch to the dashboard before the summary is read.
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  // Keep selectedChildId in sync with the active child
  useEffect(() => {
    if (data.child?.id && data.child.id !== selectedChildId) {
      setSelectedChildId(data.child.id);
    }
  }, [data.child?.id, selectedChildId]);

  // Refetch data once BOTH permissions and the active child are known — the
  // first in-flight fetch inside useBabyData was gated by a canRead() that
  // returned false for everything (no selectedChildId yet for non-admins),
  // so we need a do-over. Guarded by a ref so it fires exactly once: without
  // the ref a later child switch would double-refetch.
  const didPostPermsRefetchRef = useRef(false);
  useEffect(() => {
    if (permissionsLoaded && data.child?.id && !didPostPermsRefetchRef.current) {
      didPostPermsRefetchRef.current = true;
      data.refetch();
    }
  }, [permissionsLoaded, data.child?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { showPictureFrame, galleryPhotos, closePictureFrame } = usePictureFrame(data, prefs);

  const deleteEntry = useCallback(async (type, id) => {
    try {
      const deleteFns = {
        feeding: api.deleteFeeding,
        sleep: api.deleteSleep,
        diaper: api.deleteChange,
        tummy: api.deleteTummyTime,
        temp: api.deleteTemperature,
        weight: api.deleteWeight,
        height: api.deleteHeight,
        headcirc: api.deleteHeadCircumference,
        medication: api.deleteMedication,
        milestone: api.deleteMilestone,
        note: api.deleteNote,
        pumping: api.deletePumping,
        milkWaste: api.deleteMilkWaste,
        bmi: api.deleteBMI,
        child: api.deleteChild,
      };
      const fn = deleteFns[type];
      if (fn) {
        await fn(id);
        data.refetch();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, [data.refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saves the account's UI choice; the screen follows once the server has it.
  const setUserUi = useCallback(async (ui) => {
    await api.setMyUi(ui);
    setUserUiState(ui);
  }, []);

  // Saves the installation-wide default (admins only; the server checks).
  const setDefaultUi = useCallback(async (ui) => {
    await api.setDefaultUi(ui);
    setDefaultUiState(ui);
  }, []);

  const session = useMemo(
    () => ({
      demoMode, applianceMode, onLogout, isAdmin, canRead, canWrite, hasAnyWriteAccess, data, timer, deleteEntry,
      userUi, setUserUi, defaultUi, setDefaultUi, accountLoaded: permissionsLoaded, modal, setModal,
    }),
    [demoMode, applianceMode, onLogout, isAdmin, canRead, canWrite, hasAnyWriteAccess, data, timer, deleteEntry,
      userUi, setUserUi, defaultUi, setDefaultUi, permissionsLoaded, modal],
  );

  if (data.loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{tr("general.loading")}</span>
      </div>
    );
  }

  if (!demoMode && (data.children.length === 0 || onboardingBusy)) {
    if (isAdmin) {
      return (
        <OnboardingScreen
          onChildAdded={data.refetch}
          initialMode={setupIntent}
          onInitialModeConsumed={onSetupIntentConsumed}
          unitSystem={data.unitSystem}
          onUnitSystemChange={data.setUnitSystem}
          onBusy={setOnboardingBusy}
        />
      );
    }
    return (
      <div className="app-loading">
        <span style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: 20 }}>
          {tr("onboarding.noAccess")}<br />
          {tr("onboarding.askAdmin")}
        </span>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <UnitContext.Provider value={data.unitSystem}>
        {children}
        {showPictureFrame && galleryPhotos.length > 0 && (
          <Suspense fallback={null}>
            <PictureFrame photos={galleryPhotos} children={data.children} onWake={closePictureFrame} />
          </Suspense>
        )}
      </UnitContext.Provider>
    </SessionContext.Provider>
  );
}
