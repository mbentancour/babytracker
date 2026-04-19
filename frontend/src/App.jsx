import { useState, useEffect, useCallback, useRef } from "react";
import { useBabyData } from "./hooks/useBabyData";
import { useTimers } from "./hooks/useTimers";
import { UnitContext } from "./utils/units";
import { Icons } from "./components/Icons";
import { colors } from "./utils/colors";
import { getAge, formatElapsed } from "./utils/formatters";
import { api, setAccessToken, getAccessToken, setOnAuthRequired, enableTokenPersistence } from "./api";
import { usePreferences } from "./utils/preferences";
import { useI18n } from "./utils/i18n";
import { toLocalDatetime, localInputToUTC } from "./utils/datetime";
import OverviewTab from "./tabs/OverviewTab";
import GrowthTab from "./tabs/GrowthTab";
import NotesTab from "./tabs/NotesTab";
import FeedingForm from "./components/forms/FeedingForm";
import SleepForm from "./components/forms/SleepForm";
import DiaperForm from "./components/forms/DiaperForm";
import TemperatureForm from "./components/forms/TemperatureForm";
import TummyTimeForm from "./components/forms/TummyTimeForm";
import NoteForm from "./components/forms/NoteForm";
import WeightForm from "./components/forms/WeightForm";
import HeightForm from "./components/forms/HeightForm";
import HeadCircumferenceForm from "./components/forms/HeadCircumferenceForm";
import MedicationForm from "./components/forms/MedicationForm";
import MilestoneForm from "./components/forms/MilestoneForm";
import PumpingForm from "./components/forms/PumpingForm";
import BMIForm from "./components/forms/BMIForm";
import TimerButton from "./components/TimerButton";
import LoginScreen from "./components/LoginScreen";
import SetupWizard from "./components/SetupWizard";
import OnboardingScreen from "./components/OnboardingScreen";
import SetupChoiceScreen from "./components/SetupChoiceScreen";
import ChildForm from "./components/forms/ChildForm";
import EditChildForm from "./components/forms/EditChildForm";
import SettingsModal from "./components/SettingsModal";
import GalleryTab from "./tabs/GalleryTab";
import PictureFrame from "./components/PictureFrame";
import "./styles.css";

const TABS = [
  { id: "overview", labelKey: "nav.overview", icon: <Icons.Activity />, features: ["feeding", "sleep", "diaper", "tummy", "temp", "medication"] },
  { id: "growth", labelKey: "nav.growth", icon: <Icons.TrendUp />, features: ["weight", "height", "headcirc", "bmi"] },
  { id: "notes", labelKey: "nav.journal", icon: <Icons.StickyNote />, features: ["note", "milestone", "medication"] },
  { id: "gallery", labelKey: "nav.photos", icon: <Icons.Baby />, features: ["photo"] },
];

const ACTION_GROUPS = [
  {
    label: "Track",
    actions: [
      { id: "feeding", label: "Feeding", icon: <Icons.Bottle />, color: colors.feeding },
      { id: "sleep", label: "Sleep", icon: <Icons.Moon />, color: colors.sleep },
      { id: "diaper", label: "Diaper", icon: <Icons.Droplet />, color: colors.diaper },
      { id: "tummy", label: "Tummy", icon: <Icons.Sun />, color: colors.tummy },
      { id: "pumping", label: "Pumping", icon: <Icons.Bottle />, color: "#6C5CE7" },
    ],
  },
  {
    label: "Measure",
    actions: [
      { id: "temp", label: "Temp", icon: <Icons.Temp />, color: colors.temp },
      { id: "weight", label: "Weight", icon: <Icons.Weight />, color: colors.growth },
      { id: "height", label: "Height", icon: <Icons.Ruler />, color: colors.height },
      { id: "headcirc", label: "Head", icon: <Icons.Baby />, color: colors.growth },
      { id: "bmi", label: "BMI", icon: <Icons.TrendUp />, color: colors.feeding },
    ],
  },
  {
    label: "More",
    actions: [
      { id: "note", label: "Note", icon: <Icons.StickyNote />, color: colors.note },
      { id: "medication", label: "Meds", icon: <Icons.Temp />, color: "#e67e22" },
      { id: "milestone", label: "Milestone", icon: <Icons.TrendUp />, color: "#00b894" },
    ],
  },
];

const TIMER_TYPES = [
  { id: "feeding", label: "Feeding", icon: <Icons.Bottle />, color: colors.feeding },
  { id: "sleep", label: "Sleep", icon: <Icons.Moon />, color: colors.sleep },
  { id: "tummy", label: "Tummy Time", icon: <Icons.Sun />, color: colors.tummy },
];


function timerNameToType(name) {
  if (!name) return "feeding";
  const n = name.toLowerCase();
  if (n.includes("sleep")) return "sleep";
  if (n.includes("tummy")) return "tummy";
  return "feeding";
}

export default function App() {
  const { t } = useI18n();
  const [authState, setAuthState] = useState("loading"); // loading, setup-choice, setup, login, authenticated
  // setupIntent carries the user's first-boot choice past the register step so
  // OnboardingScreen can skip its own "what next?" picker. null after login or
  // on a pre-existing install.
  const [setupIntent, setSetupIntent] = useState(null); // null | "fresh" | "import"
  const [demoMode, setDemoMode] = useState(false);
  const [applianceMode, setApplianceMode] = useState(false);

  const handleLogout = useCallback(() => {
    setAccessToken(null);
    api.logout().catch(() => {});
    setAuthState("login");
  }, []);

  useEffect(() => {
    setOnAuthRequired(() => setAuthState("login"));

    // Check auth status and try token refresh
    Promise.all([
      api.getAuthStatus(),
      api.getConfig().catch(() => ({ demo_mode: false })),
    ]).then(([status, config]) => {
      setDemoMode(config.demo_mode);
      setApplianceMode(config.appliance_mode || false);
      // In HA add-on context, persist tokens to localStorage to work around
      // unreliable cookies in the iframe.
      if (config.ha_ingress) enableTokenPersistence();
      if (config.setup_mode) {
        setAuthState("wifi-setup");
        return;
      }
      if (config.demo_mode) {
        setAuthState("authenticated");
        return;
      }
      if (status.setup_required) {
        setAuthState("setup-choice");
        return;
      }
      // If we have a persisted access token, try using it directly. The api
      // request layer will refresh it if it's expired (or fall back to login).
      if (getAccessToken()) {
        setAuthState("authenticated");
        return;
      }
      // No persisted token — try refreshing from the cookie
      fetch("./api/auth/refresh", { method: "POST", credentials: "include" })
        .then((r) => {
          if (r.ok) return r.json();
          throw new Error("no session");
        })
        .then((data) => {
          setAccessToken(data.access_token);
          setAuthState("authenticated");
        })
        .catch(() => setAuthState("login"));
    });
  }, []);

  if (authState === "loading") {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("general.loading")}</span>
      </div>
    );
  }

  if (authState === "wifi-setup") {
    return <SetupWizard />;
  }

  if (authState === "setup-choice") {
    return (
      <SetupChoiceScreen
        onCreateAccount={() => { setSetupIntent("fresh"); setAuthState("setup"); }}
        onImport={() => { setSetupIntent("import"); setAuthState("setup"); }}
        onRestored={() => { setSetupIntent(null); setAuthState("login"); }}
      />
    );
  }

  if (authState === "setup" || authState === "login") {
    return (
      <LoginScreen
        isSetup={authState === "setup"}
        onAuthenticated={() => setAuthState("authenticated")}
        onBack={authState === "setup" ? () => setAuthState("setup-choice") : null}
      />
    );
  }

  return (
    <Dashboard
      demoMode={demoMode}
      applianceMode={applianceMode}
      onLogout={handleLogout}
      setupIntent={setupIntent}
      onSetupIntentConsumed={() => setSetupIntent(null)}
    />
  );
}

function Dashboard({ demoMode, applianceMode, onLogout, setupIntent, onSetupIntentConsumed }) {
  const { t: tr } = useI18n();
  const { isFeatureEnabled, getFormDefault, prefs } = usePreferences();
  const [activeTab, setActiveTab] = useState("overview");
  const [modal, setModal] = useState(null);
  const [showActions, setShowActions] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState("Track");
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [editingTimerId, setEditingTimerId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(demoMode);
  const [userAccess, setUserAccess] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);

  const [permissionsLoaded, setPermissionsLoaded] = useState(demoMode);
  useEffect(() => {
    if (demoMode) { setPermissionsLoaded(true); return; }
    api.getCurrentUserAccess()
      .then((res) => {
        setIsAdmin(res.is_admin);
        setUserAccess(res.access || []);
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
  const data = useBabyData(canRead);
  const timer = useTimers(data.timers, data.child?.id);

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

  // Auto-select first visible tab if current tab becomes hidden
  useEffect(() => {
    const visibleTabs = TABS.filter((tab) => tab.features.some((f) => canRead(f)));
    if (visibleTabs.length > 0 && !visibleTabs.find((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [canRead, activeTab]);

  // Picture frame screensaver
  const slideshowParam = new URLSearchParams(window.location.search).get("slideshow") === "true";
  const [showPictureFrame, setShowPictureFrame] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [slideshowTriggered, setSlideshowTriggered] = useState(false);

  // Picture frame: use refs so the idle timer doesn't get reset by re-renders
  const childIdRef = useRef(data.child?.id);
  childIdRef.current = data.child?.id;
  const startPictureFrameRef = useRef(null);

  // Picture frame prefs ref — so startPictureFrame always reads the latest
  const pfPrefsRef = useRef(prefs.pictureFrame);
  pfPrefsRef.current = prefs.pictureFrame;
  const childrenRef = useRef(data.children);
  childrenRef.current = data.children;

  const startPictureFrame = useCallback(async () => {
    const pf = pfPrefsRef.current || {};
    const allChildren = childrenRef.current || [];

    // Determine which children to fetch gallery for
    let childIds = pf.childIds?.length > 0 ? pf.childIds : allChildren.map((c) => c.id);
    if (childIds.length === 0 && childIdRef.current) childIds = [childIdRef.current];

    try {
      // Fetch gallery for each selected child and merge
      const responses = await Promise.all(
        childIds.map((cid) => api.getGallery({ child: cid }).catch(() => ({ results: [] })))
      );
      let allPhotos = [];
      const seen = new Set();
      for (const res of responses) {
        for (const item of res.results || []) {
          const key = `${item.entity_type}-${item.photo}`;
          if (!seen.has(key)) {
            seen.add(key);
            allPhotos.push(item);
          }
        }
      }

      // Map entity_type to preference key
      const typeFilter = {
        shared: "showShared",
        photo: "showPhoto",
        profile: "showProfile",
        milestone: "showMilestone",
        weight: "showWeight",
        height: "showHeight",
        head_circumference: "showHeadCirc",
        feeding: "showFeeding",
        sleep: "showSleep",
        tummy_time: "showTummy",
        diaper: "showDiaper",
        temperature: "showTemp",
        medication: "showMedication",
        note: "showNote",
      };

      allPhotos = allPhotos.filter((p) => {
        const key = typeFilter[p.entity_type];
        if (key === undefined) return true; // Unknown types: show by default
        return pf[key] !== false;
      });

      if (allPhotos.length > 0) {
        setGalleryPhotos(allPhotos);
        setShowPictureFrame(true);
      }
    } catch { /* ignore */ }
  }, []); // No deps — uses refs
  startPictureFrameRef.current = startPictureFrame;

  // ?slideshow=true — start picture frame as soon as child data is available
  useEffect(() => {
    if (slideshowParam && !slideshowTriggered && data.child?.id) {
      setSlideshowTriggered(true);
      startPictureFrame();
    }
  }, [slideshowParam, slideshowTriggered, data.child?.id, startPictureFrame]);

  // Idle timeout trigger — only re-runs when the timeout setting changes
  const pictureFrameTimeout = prefs.pictureFrameTimeout;
  useEffect(() => {
    if (!pictureFrameTimeout || pictureFrameTimeout <= 0) return;

    let idleTimer;
    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => startPictureFrame(), pictureFrameTimeout * 60 * 1000);
    };

    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [pictureFrameTimeout, startPictureFrame]);

  // Listen for remote display control via SSE (Home Assistant, etc.)
  // Device name is stored in localStorage so it persists per browser
  useEffect(() => {
    const deviceName = localStorage.getItem("babytracker_device_name") || "default";
    const evtSource = new EventSource(`./api/display/events?device=${encodeURIComponent(deviceName)}`);
    let isFirst = true;
    evtSource.onmessage = (e) => {
      try {
        const state = JSON.parse(e.data);
        if (isFirst) { isFirst = false; return; }
        if (state.picture_frame) {
          startPictureFrameRef.current();
        } else {
          setShowPictureFrame(false);
        }
      } catch { /* ignore */ }
    };
    return () => evtSource.close();
  }, [startPictureFrame]);

  const closeModal = () => setModal(null);
  const handleFormDone = () => {
    closeModal();
    data.refetch();
  };

  const handleDeleteEntry = async (type, id) => {
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
  };

  if (data.loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{tr("general.loading")}</span>
      </div>
    );
  }

  if (!demoMode && data.children.length === 0) {
    if (isAdmin) {
      return <OnboardingScreen onChildAdded={data.refetch} initialMode={setupIntent} onInitialModeConsumed={onSetupIntentConsumed} />;
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
    <UnitContext.Provider value={data.unitSystem}>
    <div className="app">
      {/* Header */}
      <header className="app-header fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            className="avatar"
            style={{ cursor: "pointer" }}
            onClick={() => data.child && setModal({ type: "editChild", child: data.child })}
            title={tr("general.tapToEdit")}
          >
            {data.child?.picture ? (
              <img src={data.child.picture} alt={data.child.first_name} className="avatar-img" />
            ) : (
              <Icons.Baby />
            )}
          </div>
          <div
            style={{ cursor: "pointer" }}
            onClick={() => data.child && setModal({ type: "editChild", child: data.child })}
            title={tr("general.tapToEdit")}
          >
            <h1 className="baby-name">
              {data.child?.first_name || "Baby"}
            </h1>
            {data.child?.birth_date && (
              <span className="baby-age">{getAge(data.child.birth_date)}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data.error && (
            <span className="sync-error">{tr("general.connectionError")}</span>
          )}
          <button className="refresh-btn" onClick={() => setModal({ type: "settings" })} title="Settings">
            <Icons.Settings />
          </button>
        </div>
      </header>

      {/* Child Switcher — only shown when more than one child. The "add baby"
          action lives in the header for admins so a single-child setup doesn't
          carry an empty row. */}
      {data.children.length > 1 && (
        <div className="child-switcher fade-in">
          {data.children.map((c) => (
            <button
              key={c.id}
              className={`child-chip${c.id === data.child?.id ? " child-chip-active" : ""}`}
              onClick={() => data.selectChild(c.id)}
            >
              {c.first_name}
            </button>
          ))}
        </div>
      )}

      {/* Active Timer Bars */}
      {timer.activeTimers.map((t) => (
        <div key={t.id} className="timer-bar fade-in">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="timer-pulse" />
            <Icons.Timer />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {t.name}
              {data.children.length > 1 && (
                <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 6 }}>
                  ({data.children.find((c) => c.id === t.childId)?.first_name})
                </span>
              )}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {editingTimerId === t.id ? (
              <input
                type="datetime-local"
                className="timer-edit-input"
                defaultValue={toLocalDatetime(t.start)}
                autoFocus
                onBlur={(e) => {
                  if (e.target.value) {
                    timer.editTimer(t.id, localInputToUTC(e.target.value));
                  }
                  setEditingTimerId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") setEditingTimerId(null);
                }}
              />
            ) : (
              <span
                className="timer-elapsed"
                style={{ cursor: "pointer" }}
                title="Click to edit start time"
                onClick={() => setEditingTimerId(t.id)}
              >
                {formatElapsed(timer.elapsedMap[t.id] || 0)}
              </span>
            )}
            <button
              className="timer-save-btn"
              onClick={async () => {
                const stopped = await timer.stopTimer(t.id);
                if (stopped) {
                  setModal({ type: timerNameToType(stopped.name), timerId: stopped.id });
                }
              }}
            >
              Save
            </button>
            <button
              className="timer-discard-btn"
              onClick={() => timer.discardTimer(t.id)}
            >
              <Icons.X />
            </button>
          </div>
        </div>
      ))}

      {/* Tab Navigation — bar on desktop, dropdown on mobile */}
      {(() => {
        const visibleTabs = TABS.filter((tab) => tab.features.some((f) => canRead(f)));
        return (
          <>
            <nav className="tab-nav tab-nav-desktop fade-in">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-btn ${activeTab === tab.id ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.icon}
                  {tr(tab.labelKey)}
                </button>
              ))}
            </nav>
            <div className="tab-nav-mobile fade-in">
              <select
                className="tab-select"
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value)}
              >
                {visibleTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>{tr(tab.labelKey)}</option>
                ))}
              </select>
            </div>
          </>
        );
      })()}

      {/* Tab Content */}
      <main className="tab-content">
        {activeTab === "overview" && (
          <OverviewTab
            feedings={data.feedings}
            weeklyFeedings={data.weeklyFeedings}
            sleepEntries={data.sleepEntries}
            weeklySleep={data.weeklySleep}
            changes={data.changes}
            tummyTimes={data.tummyTimes}
            weeklyTummyTimes={data.weeklyTummyTimes}
            temperatures={data.temperatures}
            medications={data.medications}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(type) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(type) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "growth" && (
          <GrowthTab
            weights={data.weights}
            heights={data.heights}
            headCircumferences={data.headCircumferences}
            bmiEntries={data.bmiEntries}
            monthlyFeedings={data.monthlyFeedings}
            monthlySleep={data.monthlySleep}
            child={data.child}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(type) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(type) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "notes" && (
          <NotesTab
            notes={data.notes}
            milestones={data.milestones}
            medications={data.medications}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(type) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(type) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "gallery" && (
          <GalleryTab childId={data.child?.id} children={data.children} canWrite={canWrite("photo")} />
        )}
      </main>

      {/* Quick Action FAB */}
      <div className="fab-container">
        {showActions && (
          <div className="fab-menu fade-in">
            {ACTION_GROUPS.map((group) => {
              const filteredActions = group.actions.filter((a) => isFeatureEnabled(a.id) && canWrite(a.id));
              if (filteredActions.length === 0) return null;
              const isOpen = expandedGroup === group.label;
              return (
                <div key={group.label} className="fab-group">
                  <button
                    className={`fab-group-label${isOpen ? " fab-group-label-active" : ""}`}
                    onClick={() => setExpandedGroup(isOpen ? null : group.label)}
                  >
                    {group.label}
                  </button>
                  {isOpen && (
                    <div className="fab-group-items">
                      {filteredActions.map((action) => (
                        <button
                          key={action.id}
                          className="fab-action"
                          onClick={() => {
                            setModal({ type: action.id });
                            setShowActions(false);
                          }}
                        >
                          <span
                            className="fab-action-icon"
                            style={{ background: `${action.color}18`, color: action.color }}
                          >
                            {action.icon}
                          </span>
                          <span className="fab-action-label">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {showTimerPicker && (
          <div className="fab-menu fade-in" style={{ right: 76 }}>
            {TIMER_TYPES.filter((t) => canWrite(t.id === "tummy" ? "tummy" : t.id === "sleep" ? "sleep" : "feeding")).map((t) => (
              <button
                key={t.id}
                className="fab-action"
                onClick={() => {
                  timer.startTimer(t.id);
                  setShowTimerPicker(false);
                }}
              >
                <span
                  className="fab-action-icon"
                  style={{ background: `${t.color}18`, color: t.color }}
                >
                  {t.icon}
                </span>
                <span className="fab-action-label">{t.label}</span>
              </button>
            ))}
          </div>
        )}
        {(canWrite("feeding") || canWrite("sleep") || canWrite("tummy")) && (
          <TimerButton
            label="Timer"
            icon={<Icons.Timer />}
            color={colors.feeding}
            active={false}
            onClick={() => {
              setShowTimerPicker(!showTimerPicker);
              setShowActions(false);
            }}
          />
        )}
        {hasAnyWriteAccess && (
          <button
            className="fab-btn"
            style={{ background: showActions ? "var(--text-muted)" : colors.feeding }}
            onClick={() => { setShowActions(!showActions); setShowTimerPicker(false); setExpandedGroup("Track"); }}
          >
            <span style={{ transform: showActions ? "rotate(45deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
              <Icons.Plus />
            </span>
          </button>
        )}
      </div>

      {/* Modals */}
      {modal?.type === "feeding" && (
        <FeedingForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          defaultType={getFormDefault("feeding", "type")}
          defaultMethod={getFormDefault("feeding", "method")}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("feeding", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "sleep" && (
        <SleepForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("sleep", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "diaper" && (
        <DiaperForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("diaper", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "temp" && (
        <TemperatureForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("temp", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "tummy" && (
        <TummyTimeForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("tummy", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "weight" && (
        <WeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("weight", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "height" && (
        <HeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("height", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "note" && (
        <NoteForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("note", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "headcirc" && (
        <HeadCircumferenceForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("headcirc", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "medication" && (
        <MedicationForm
          childId={data.child?.id}
          entry={modal.entry}
          defaultDosageUnit={getFormDefault("medication", "dosage_unit")}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("medication", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "bmi" && (
        <BMIForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("bmi", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "pumping" && (
        <PumpingForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("pumping", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "milestone" && (
        <MilestoneForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("milestone", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "addChild" && (
        <ChildForm
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "editChild" && modal.child && (
        <EditChildForm
          child={modal.child}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={isAdmin ? () => { handleDeleteEntry("child", modal.child.id); closeModal(); } : undefined}
          onAddBaby={isAdmin ? () => setModal({ type: "addChild" }) : undefined}
        />
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          childId={data.child?.id}
          unitSystem={data.unitSystem}
          children={data.children}
          isAdmin={isAdmin}
          applianceMode={applianceMode}
          onClose={closeModal}
          onLogout={demoMode ? undefined : onLogout}
          onRefetch={data.refetch}
        />
      )}
      {showPictureFrame && galleryPhotos.length > 0 && (
        <PictureFrame
          photos={galleryPhotos}
          children={data.children}
          onWake={() => {
            setShowPictureFrame(false);
            // Remove ?slideshow=true from URL so it doesn't restart
            if (slideshowParam) {
              const url = new URL(window.location);
              url.searchParams.delete("slideshow");
              window.history.replaceState({}, "", url);
            }
          }}
        />
      )}
    </div>
    </UnitContext.Provider>
  );
}
