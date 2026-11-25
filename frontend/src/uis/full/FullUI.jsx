import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useSession } from "../../core/session";
import { ACTION_GROUPS, TIMER_TYPES, entryFeature, formatPauses, timerNameToType, getTimerLabel } from "../../core/activities";
import AppModals, { useAppModal } from "../../components/AppModals";
import { Icons } from "../../components/Icons";
import TimerButton from "../../components/TimerButton";
import { colors } from "../../utils/colors";
import { getAge, formatElapsed } from "../../utils/formatters";
import { usePreferences } from "../../utils/preferences";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";
const OverviewTab = lazy(() => import("../../tabs/OverviewTab"));
const GrowthTab = lazy(() => import("../../tabs/GrowthTab"));
const NotesTab = lazy(() => import("../../tabs/NotesTab"));
const DayTab = lazy(() => import("../../tabs/DayTab"));
const RoutineTab = lazy(() => import("../../tabs/RoutineTab"));
const GalleryTab = lazy(() => import("../../tabs/GalleryTab"));

// `view` marks a tab as optional: it appears only when that per-device view
// preference is on (Settings > Preferences > Views). Tabs without one are the
// original four and are always present, subject to the usual read permissions.
const TABS = [
  { id: "overview", labelKey: "nav.overview", icon: <Icons.Activity />, features: ["feeding", "sleep", "diaper", "tummy", "pumping", "temp", "medication"] },
  { id: "day", labelKey: "nav.day", icon: <Icons.Clock />, view: "day", features: ["feeding", "sleep", "diaper", "tummy", "pumping", "temp", "medication", "note"] },
  { id: "routine", labelKey: "nav.routine", icon: <Icons.Timer />, view: "routine", features: ["feeding", "sleep", "diaper", "tummy", "pumping"] },
  { id: "growth", labelKey: "nav.growth", icon: <Icons.TrendUp />, features: ["weight", "height", "headcirc", "bmi"] },
  { id: "notes", labelKey: "nav.journal", icon: <Icons.StickyNote />, features: ["note", "milestone", "medication"] },
  { id: "gallery", labelKey: "nav.photos", icon: <Icons.Baby />, features: ["photo"] },
];

// The full UI: header, child switcher, timer bars, tabbed dashboards and the
// quick-action button. Everything it shows comes from useSession().
export default function FullUI() {
  const { t: tr } = useI18n();
  const { isFeatureEnabled, isViewEnabled } = usePreferences();
  const { data, timer, canRead, canWrite, hasAnyWriteAccess, deleteEntry: handleDeleteEntry } = useSession();
  const { modal, setModal, closeModal, handleFormDone } = useAppModal();
  const [activeTab, setActiveTab] = useState("overview");
  const [showActions, setShowActions] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState("track");
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [editingTimerId, setEditingTimerId] = useState(null);

  // A tab is visible when the user can read at least one of its features and,
  // for the optional views, when that view is switched on for this device.
  const isTabVisible = useCallback(
    (tab) => (!tab.view || isViewEnabled(tab.view)) && tab.features.some((f) => canRead(f)),
    [canRead, isViewEnabled],
  );

  // Auto-select first visible tab if current tab becomes hidden — including
  // when the user switches an optional view off while standing on it.
  useEffect(() => {
    const visibleTabs = TABS.filter(isTabVisible);
    if (visibleTabs.length > 0 && !visibleTabs.find((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [isTabVisible, activeTab]);

  // The avatar and name blocks in the header are the only entry point for
  // editing a child; they're divs, so keyboard access needs explicit wiring.
  const openEditChild = () => data.child && setModal({ type: "editChild", child: data.child });
  const editChildKeys = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEditChild();
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            className="avatar"
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            aria-label={tr("general.tapToEdit")}
            onClick={openEditChild}
            onKeyDown={editChildKeys}
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
            role="button"
            tabIndex={0}
            aria-label={tr("general.tapToEdit")}
            onClick={openEditChild}
            onKeyDown={editChildKeys}
            title={tr("general.tapToEdit")}
          >
            <h1 className="baby-name">
              {data.child?.first_name || tr("general.baby")}
            </h1>
            {data.child?.birth_date && (
              <span className="baby-age">{getAge(data.child.birth_date, tr)}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data.error && (
            <span className="sync-error">{tr("general.connectionError")}</span>
          )}
          <button className="refresh-btn" onClick={() => setModal({ type: "settings" })} title={tr("settings.title")} aria-label={tr("settings.title")}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {getTimerLabel(t.name, tr)}
                {data.children.length > 1 && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 6 }}>
                    ({data.children.find((c) => c.id === t.childId)?.first_name})
                  </span>
                )}
              </span>
              {formatPauses(t.pauses) && (
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                  {tr("timer.pauses")}: {formatPauses(t.pauses)}
                </span>
              )}
            </div>
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
                title={tr("timer.editStart")}
                onClick={() => setEditingTimerId(t.id)}
              >
                {formatElapsed(timer.elapsedMap[t.id] || 0)}
              </span>
            )}
            <button
              className="timer-pause-btn"
              onClick={() => timer.pauseTimer(t.id)}
              title={tr("timer.pause")}
              aria-label={tr("timer.pause")}
            >
              <Icons.Pause />
            </button>
            <button
              className="timer-save-btn"
              onClick={async () => {
                const stopped = await timer.stopTimer(t.id);
                if (stopped) {
                  setModal({ type: timerNameToType(stopped.name), timerId: stopped.id });
                }
              }}
              title={tr("timer.save")}
              aria-label={tr("timer.save")}
            >
              <Icons.Save />
            </button>
            <button
              className="timer-discard-btn"
              onClick={() => timer.discardTimer(t.id)}
              title={tr("timer.discard")}
              aria-label={tr("timer.discard")}
            >
              <Icons.X />
            </button>
          </div>
        </div>
      ))}

      {/* Paused Timer Bars */}
      {timer.pausedTimers.map((t) => (
        <div key={t.id} className="timer-bar timer-bar-paused fade-in">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="timer-pulse" style={{ opacity: 0.5 }} />
            <Icons.Timer style={{ opacity: 0.7 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.8 }}>
                {getTimerLabel(t.name, tr)}
                {data.children.length > 1 && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 6 }}>
                    ({data.children.find((c) => c.id === t.childId)?.first_name})
                  </span>
                )}
              </span>
              {formatPauses(t.pauses) && (
                <span style={{ fontSize: 10, color: "var(--text-dim)", opacity: 0.7 }}>
                  {tr("timer.pauses")}: {formatPauses(t.pauses)}
                </span>
              )}
            </div>
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
                title={tr("timer.editStart")}
                onClick={() => setEditingTimerId(t.id)}
              >
                {formatElapsed(timer.elapsedMap[t.id] || 0)}
              </span>
            )}
            <button
              className="timer-resume-btn"
              onClick={() => timer.resumePausedTimer(t.id)}
              title={tr("timer.resume")}
              aria-label={tr("timer.resume")}
            >
              <Icons.Play />
            </button>
            <button
              className="timer-save-btn"
              onClick={async () => {
                const stopped = await timer.stopTimer(t.id);
                if (stopped) {
                  setModal({ type: timerNameToType(stopped.name), timerId: stopped.id });
                }
              }}
              title={tr("timer.save")}
              aria-label={tr("timer.save")}
            >
              <Icons.Save />
            </button>
            <button
              className="timer-discard-btn"
              onClick={() => timer.discardTimer(t.id)}
              title={tr("timer.discard")}
              aria-label={tr("timer.discard")}
            >
              <Icons.X />
            </button>
          </div>
        </div>
      ))}

      {/* Tab Navigation — bar on desktop, dropdown on mobile */}
      {(() => {
        const visibleTabs = TABS.filter(isTabVisible);
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
        <Suspense
          fallback={
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{tr("general.loading")}</span>
            </div>
          }
        >
        {activeTab === "overview" && (
          <OverviewTab
            feedings={data.feedings}
            weeklyFeedings={data.weeklyFeedings}
            sleepEntries={data.sleepEntries}
            weeklySleep={data.weeklySleep}
            changes={data.changes}
            weeklyChanges={data.weeklyChanges}
            tummyTimes={data.tummyTimes}
            weeklyTummyTimes={data.weeklyTummyTimes}
            pumpingSessions={data.pumpingSessions}
            weeklyPumping={data.weeklyPumping}
            weeklyMilkWaste={data.weeklyMilkWaste}
            milkStock={data.milkStock}
            temperatures={data.temperatures}
            medications={data.medications}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(entryFeature(type)) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(entryFeature(type)) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "day" && (
          <DayTab
            childId={data.child?.id}
            canRead={canRead}
            canWrite={canWrite}
            onEditEntry={(type, entry) => canWrite(entryFeature(type)) && setModal({ type, entry })}
          />
        )}
        {activeTab === "routine" && (
          <RoutineTab childId={data.child?.id} canRead={canRead} />
        )}
        {activeTab === "growth" && (
          <GrowthTab
            weights={data.weights}
            heights={data.heights}
            headCircumferences={data.headCircumferences}
            bmiEntries={data.bmiEntries}
            monthlyFeedings={data.monthlyFeedings}
            monthlySleep={data.monthlySleep}
            monthlyPumping={data.monthlyPumping}
            child={data.child}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(entryFeature(type)) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(entryFeature(type)) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "notes" && (
          <NotesTab
            notes={data.notes}
            milestones={data.milestones}
            medications={data.medications}
            tagMaps={data.tagMaps}
            onEditEntry={(type, entry) => canWrite(entryFeature(type)) && setModal({ type, entry })}
            onDeleteEntry={(type, id) => canWrite(entryFeature(type)) && handleDeleteEntry(type, id)}
            canWrite={canWrite}
          />
        )}
        {activeTab === "gallery" && (
          <GalleryTab childId={data.child?.id} children={data.children} canWrite={canWrite("photo")} />
        )}
        </Suspense>
      </main>

      {/* Quick Action FAB */}
      <div className="fab-container">
        {showActions && (
          <div className="fab-menu fade-in">
            {ACTION_GROUPS.map((group) => {
              const filteredActions = group.actions.filter((a) => {
                // An action may borrow another feature's permission (`feature`)
                // and may additionally be gated on an optional view (`view`).
                if (a.view && !isViewEnabled(a.view)) return false;
                const feature = a.feature || a.id;
                return isFeatureEnabled(feature) && canWrite(feature);
              });
              if (filteredActions.length === 0) return null;
              const isOpen = expandedGroup === group.id;
              return (
                <div key={group.id} className="fab-group">
                  <button
                    className={`fab-group-label${isOpen ? " fab-group-label-active" : ""}`}
                    onClick={() => setExpandedGroup(isOpen ? null : group.id)}
                  >
                    {tr(group.labelKey)}
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
                          <span className="fab-action-label">{tr(action.labelKey)}</span>
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
                <span className="fab-action-label">{tr(t.labelKey)}</span>
              </button>
            ))}
          </div>
        )}
        {(canWrite("feeding") || canWrite("sleep") || canWrite("tummy")) && (
          <TimerButton
            label={tr("timer.label")}
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
            onClick={() => { setShowActions(!showActions); setShowTimerPicker(false); setExpandedGroup("track"); }}
          >
            <span style={{ transform: showActions ? "rotate(45deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
              <Icons.Plus />
            </span>
          </button>
        )}
      </div>

      <AppModals modal={modal} setModal={setModal} closeModal={closeModal} handleFormDone={handleFormDone} />
    </div>
  );
}
