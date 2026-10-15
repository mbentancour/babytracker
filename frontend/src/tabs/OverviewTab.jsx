import { useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import TimelineItem from "../components/TimelineItem";
import DiaperBadge from "../components/DiaperBadge";
import CustomTooltip from "../components/CustomTooltip";
import ChartDetailBar from "../components/ChartDetailBar";
import DayActivitiesModal from "../components/DayActivitiesModal";
import MilkStock from "../components/MilkStock";
import TagChips from "../components/TagChips";
import SleepTypeToggle from "../components/SleepTypeToggle";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import {
  toFeedingTimeline,
  toDiaperTimeline,
  toSleepBlocks,
  toPumpingTimeline,
  aggregateByDayOfWeek,
  aggregateSleepByDay,
  aggregateTummyByDay,
  aggregateDiapersByDay,
  getEntriesForDay,
  overlapHours,
  parseDuration,
  formatSleepDuration,
  getDisplayLocale,
  mostRecentAt,
  lastSeenLabel,
} from "../utils/formatters";
import { useUnits } from "../utils/units";
import { usePreferences } from "../utils/preferences";
import { useI18n } from "../utils/i18n";

const COLLAPSED_COUNT = 2;

export default function OverviewTab({ feedings, weeklyFeedings: weeklyFeedingsRaw, sleepEntries, weeklySleep, changes, weeklyChanges = [], tummyTimes, weeklyTummyTimes, pumpingSessions = [], weeklyPumping = [], weeklyMilkWaste = [], milkStock = null, temperatures, medications, tagMaps = {}, onEditEntry, onDeleteEntry, canWrite = () => true }) {
  const units = useUnits();
  const { t } = useI18n();
  const { isFeatureEnabled, isViewEnabled } = usePreferences();
  const [expanded, setExpanded] = useState({});
  const [dayModal, setDayModal] = useState(null);
  const [selectedBar, setSelectedBar] = useState(null);
  const [sleepType, setSleepType] = useState("total");
  const [sleepPeriod, setSleepPeriod] = useState("today");
  const [diaperType, setDiaperType] = useState("total");
  const touchSelectionUntil = useRef(0);
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const feedingTimeline = toFeedingTimeline(feedings, units.volume, t);
  const diaperMatches = (c) => diaperType === "total" || (diaperType === "wet" ? c.wet : c.solid);
  const diaperTimeline = toDiaperTimeline(changes.filter(diaperMatches), t);
  const sleepBlocks = toSleepBlocks(sleepEntries);
  const filteredSleepBlocks = sleepType === "total"
    ? sleepBlocks
    : sleepBlocks.filter((entry) => sleepType === "nap" ? entry.nap : !entry.nap);
  const weeklyFeedings = aggregateByDayOfWeek(weeklyFeedingsRaw, "amount");
  const filteredWeeklySleep = sleepType === "total"
    ? weeklySleep
    : weeklySleep.filter((entry) => sleepType === "nap" ? entry.nap : !entry.nap);
  const sleepByDay = aggregateSleepByDay(filteredWeeklySleep);
  const tummyByDay = aggregateTummyByDay(weeklyTummyTimes);
  const filteredWeeklyChanges = weeklyChanges.filter(diaperMatches);
  const diapersByDay = aggregateDiapersByDay(filteredWeeklyChanges);
  const pumpingTimeline = toPumpingTimeline(pumpingSessions, units.volume, t);
  const pumpingByDay = aggregateByDayOfWeek(weeklyPumping, "amount");

  const totalFeeding = feedings.reduce((s, f) => s + (f.amount || 0), 0);
  const totalPumping = pumpingSessions.reduce((s, p) => s + (p.amount || 0), 0);
  // Clip sleep entries to either the local calendar day or rolling 24-hour
  // window. This preserves partial overnight sessions and ongoing sleeps.
  const sleepWindowEnd = Date.now();
  const todayStart = new Date(sleepWindowEnd);
  todayStart.setHours(0, 0, 0, 0);
  const sleepWindowStart = sleepPeriod === "24h"
    ? sleepWindowEnd - 24 * 60 * 60 * 1000
    : todayStart.getTime();
  const totalSleep = sleepEntries.reduce(
    (s, e) => s + overlapHours(e, sleepWindowStart, sleepWindowEnd),
    0
  );
  const totalDiapers = changes.length;
  const avgTummy =
    tummyTimes.length > 0
      ? tummyTimes.reduce((s, t) => s + parseDuration(t.duration) * 60, 0) /
        tummyTimes.length
      : 0;

  // "Last: 5m ago" for each stat card.
  //
  // Read from the seven-day sets, not the today-only ones the numbers above
  // come from. That is the whole point: at 00:30 today's feeding count is 0
  // and the last feed was at 23:40, and reading "0 feedings today" told you
  // nothing about whether that was twenty minutes or six hours back.
  const lastSeen = (entries) => {
    const at = mostRecentAt(entries);
    return at === null ? null : lastSeenLabel(at, t);
  };
  const lastFeeding = lastSeen(weeklyFeedingsRaw);
  const lastSleep = lastSeen(weeklySleep);
  const lastDiaper = lastSeen(weeklyChanges.length ? weeklyChanges : changes);
  const lastTummy = lastSeen(weeklyTummyTimes);
  const lastPumping = lastSeen(weeklyPumping);

  const wetCount = changes.filter((c) => c.wet).length;
  const solidCount = changes.filter((c) => c.solid).length;
  const bothCount = changes.filter((c) => c.wet && c.solid).length;

  // Recharts v3 dropped `activePayload` from chart click events, so we can't
  // read the bar's value directly out of the event. Resolve it by indexing
  // into the chart's data array using `activeTooltipIndex` (or the legacy
  // `activeIndex` as a fallback). Read the label from that point rather than
  // `activeLabel`: on touch devices activeLabel can lag one tap behind.
  const selectChartPoint = (data, type, seriesData, dataKey) => {
    if (!data || !seriesData) return;
    const idx = data.activeTooltipIndex ?? data.activeIndex;
    const point = idx != null ? seriesData[idx] : undefined;
    const value = point ? point[dataKey] : undefined;
    if (value == null) return;
    const label = point.day ?? point.date;
    if (!label) return;
    setSelectedBar({ type, label, value });
  };

  const handleChartClick = (data, type, seriesData, dataKey) => {
    // Mobile browsers dispatch a click after touchend. Recharts can still
    // expose the previous active point for that synthetic click, so keep the
    // touch selection and ignore the stale follow-up event.
    if (Date.now() < touchSelectionUntil.current) return;
    selectChartPoint(data, type, seriesData, dataKey);
  };

  const handleBarTouchEnd = (event, type, seriesData, dataKey) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    // The wrapper and the seven category bands share the same horizontal
    // coordinate system. This also works when Recharts omits zero bars.
    const relativeX = Math.max(0, Math.min(rect.width, touch.clientX - rect.left));
    const index = Math.max(0, Math.min(seriesData.length - 1,
      Math.floor(relativeX / (rect.width / seriesData.length))));
    const point = seriesData[index];
    if (!point) return;
    touchSelectionUntil.current = Date.now() + 750;
    setSelectedBar({ type, label: point.day ?? point.date, value: point[dataKey] });
  };

  const blockSyntheticChartClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const openDayModal = (day, type) => {
    let dayData = [];
    if (type === "feeding") {
      dayData = getEntriesForDay(weeklyFeedingsRaw, day, "start");
    } else if (type === "sleep") {
      dayData = getEntriesForDay(filteredWeeklySleep, day, "start");
    } else if (type === "tummy") {
      dayData = getEntriesForDay(weeklyTummyTimes, day, "start");
    } else if (type === "pumping") {
      dayData = getEntriesForDay(weeklyPumping, day, "start");
    } else if (type === "diaper") {
      dayData = getEntriesForDay(filteredWeeklyChanges, day, "time");
    }
    setSelectedBar(null);
    setDayModal({ day, type, data: dayData });
  };

  return (
    <>
      {/* Quick Stats */}
      <div className="stat-grid">
        {isFeatureEnabled("feeding") && (
          <div className="fade-in fade-in-1">
            <StatCard
              icon={<Icons.Bottle />}
              label={t("overview.feedings")}
              value={totalFeeding > 0 ? `${Math.round(totalFeeding)} ${units.volume}` : `${feedings.length}`}
              sub={t(feedings.length === 1 ? "overview.feedingsToday_one" : "overview.feedingsToday_other", { count: feedings.length })}
              foot={lastFeeding}
              color={colors.feeding}
              onAdd={canWrite("feeding") ? () => onEditEntry?.("feeding") : undefined}
              addLabel={t("action.feeding")}
            />
          </div>
        )}
        {isFeatureEnabled("sleep") && (
          <div className="fade-in fade-in-2">
            <StatCard
              icon={<Icons.Moon />}
              label={t("overview.sleep")}
              value={`${totalSleep.toFixed(1)}h`}
              sub={<SleepPeriodToggle value={sleepPeriod} onChange={setSleepPeriod} />}
              foot={lastSleep}
              color={colors.sleep}
              onAdd={canWrite("sleep") ? () => onEditEntry?.("sleep") : undefined}
              addLabel={t("action.sleep")}
            />
          </div>
        )}
        {isFeatureEnabled("diaper") && (
          <div className="fade-in fade-in-3">
            <StatCard
              icon={<Icons.Droplet />}
              label={t("overview.diapers")}
              value={totalDiapers}
              sub={t("overview.diaperBreakdown", { wet: wetCount, solid: solidCount, both: bothCount })}
              foot={lastDiaper}
              color={colors.diaper}
              onAdd={canWrite("diaper") ? () => onEditEntry?.("diaper") : undefined}
              addLabel={t("action.diaper")}
            />
          </div>
        )}
        {isFeatureEnabled("tummy") && (
          <div className="fade-in fade-in-4">
            <StatCard
              icon={<Icons.Sun />}
              label={t("overview.tummyTime")}
              value={`${Math.round(avgTummy)}m`}
              sub={t(tummyTimes.length === 1 ? "overview.sessionsToday_one" : "overview.sessionsToday_other", { count: tummyTimes.length })}
              foot={lastTummy}
              color={colors.tummy}
              onAdd={canWrite("tummy") ? () => onEditEntry?.("tummy") : undefined}
              addLabel={t("action.tummy")}
            />
          </div>
        )}
        {isFeatureEnabled("pumping") && (
          <div className="fade-in fade-in-5">
            <StatCard
              icon={<Icons.Bottle />}
              label={t("overview.pumping")}
              value={totalPumping > 0 ? `${Math.round(totalPumping)} ${units.volume}` : `${pumpingSessions.length}`}
              sub={t(pumpingSessions.length === 1 ? "overview.sessionsToday_one" : "overview.sessionsToday_other", { count: pumpingSessions.length })}
              foot={lastPumping}
              color={colors.pumping}
              onAdd={canWrite("pumping") ? () => onEditEntry?.("pumping") : undefined}
              addLabel={t("action.pumping")}
            />
          </div>
        )}
      </div>

      {/* Main Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {/* Feeding Timeline */}
        {isFeatureEnabled("feeding") && <div className="fade-in fade-in-3">
          <SectionCard title={t("overview.recentFeedings")} icon={<Icons.Bottle />} color={colors.feeding}>
            {feedingTimeline.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(expanded.feedings ? feedingTimeline : feedingTimeline.slice(0, COLLAPSED_COUNT)).map((f, i, arr) => (
                  <div key={i} className="entry-clickable" onClick={() => onEditEntry?.("feeding", f.entry)}>
                    <TimelineItem
                      time={f.time}
                      label={f.label}
                      detail={f.detail}
                      color={colors.feeding}
                      isLast={i === arr.length - 1}
                      tags={tagMaps.feeding?.[f.entry?.id]}
                    />
                  </div>
                ))}
                {feedingTimeline.length > COLLAPSED_COUNT && (
                  <button className="expand-toggle" onClick={() => toggle("feedings")}>
                    {expanded.feedings ? t("overview.showLess") : t("overview.showMore", { count: feedingTimeline.length - COLLAPSED_COUNT })}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("overview.noFeedings")}
              </div>
            )}
            {weeklyFeedings.some((d) => d.amount > 0) && (
              <>
                <div style={{ marginTop: 16, height: 120 }} onTouchEnd={(event) => handleBarTouchEnd(event, "feeding", weeklyFeedings, "amount")} onClick={blockSyntheticChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyFeedings} barSize={18} onClick={(data) => handleChartClick(data, "feeding", weeklyFeedings, "amount")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" fill={colors.feeding} radius={[6, 6, 0, 0]} opacity={0.85} cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "feeding" && (
                  <ChartDetailBar
                    label={selectedBar.label}
                    value={selectedBar.value}
                    unit={units.volume}
                    color={colors.feeding}
                    onViewEntries={() => openDayModal(selectedBar.label, "feeding")}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            )}
          </SectionCard>
        </div>}

        {/* Sleep */}
        {isFeatureEnabled("sleep") && <div className="fade-in fade-in-4">
          <SectionCard
            title={t("overview.sleepPattern")}
            icon={<Icons.Moon />}
            color={colors.sleep}
            action={<SleepTypeToggle value={sleepType} onChange={(type) => {
              setSleepType(type);
              setSelectedBar(null);
              setDayModal(null);
            }} />}
          >
            {filteredSleepBlocks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(expanded.sleep ? filteredSleepBlocks : filteredSleepBlocks.slice(0, COLLAPSED_COUNT)).map((s, i, arr) => (
                  <div key={i} className="entry-clickable" onClick={() => onEditEntry?.("sleep", s.entry)}>
                    <TimelineItem
                      time={`${s.start}–${s.end}`}
                      label={`${formatSleepDuration(s.duration)} · ${s.nap ? t("sleep.nap") : t("sleep.night")}`}
                      detail={t("general.timeRange", { from: s.start, to: s.end })}
                      color={colors.sleep}
                      isLast={i === arr.length - 1}
                      tags={tagMaps.sleep?.[s.entry?.id]}
                    />
                  </div>
                ))}
                {filteredSleepBlocks.length > COLLAPSED_COUNT && (
                  <button className="expand-toggle" onClick={() => toggle("sleep")}>
                    {expanded.sleep ? t("overview.showLess") : t("overview.showMore", { count: filteredSleepBlocks.length - COLLAPSED_COUNT })}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("overview.noSleep")}
              </div>
            )}
            {sleepByDay.some((d) => d.hours > 0) && (
              <>
                <div style={{ marginTop: 16, height: 120 }} onTouchEnd={(event) => handleBarTouchEnd(event, "sleep", sleepByDay, "hours")} onClick={blockSyntheticChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sleepByDay} barSize={18} onClick={(data) => handleChartClick(data, "sleep", sleepByDay, "hours")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="hours" fill={colors.sleep} radius={[6, 6, 0, 0]} opacity={0.85} cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "sleep" && (
                  <ChartDetailBar
                    label={selectedBar.label}
                    value={selectedBar.value}
                    unit="h"
                    color={colors.sleep}
                    onViewEntries={() => openDayModal(selectedBar.label, "sleep")}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            )}
          </SectionCard>
        </div>}

        {/* Diapers */}
        {isFeatureEnabled("diaper") && <div className="fade-in fade-in-5">
          <SectionCard
            title={t("overview.diaperChanges")}
            icon={<Icons.Droplet />}
            color={colors.diaper}
            action={<DiaperTypeToggle value={diaperType} onChange={(type) => {
              setDiaperType(type);
              setSelectedBar(null);
              setDayModal(null);
            }} />}
          >
            {diaperTimeline.length > 0 ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(expanded.diapers ? diaperTimeline : diaperTimeline.slice(0, COLLAPSED_COUNT)).map((d, i) => (
                    <div
                      key={i}
                      className="entry-clickable"
                      onClick={() => onEditEntry?.("diaper", d.entry)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: i === 0 ? `${colors.diaper}08` : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                        <DiaperBadge type={d.type} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{d.time}</span>
                        <TagChips tags={tagMaps.diaper?.[d.entry?.id]} size="sm" />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
                        {d.ago}
                      </span>
                    </div>
                  ))}
                  {diaperTimeline.length > COLLAPSED_COUNT && (
                    <button className="expand-toggle" onClick={() => toggle("diapers")}>
                      {expanded.diapers ? t("overview.showLess") : t("overview.showMore", { count: diaperTimeline.length - COLLAPSED_COUNT })}
                    </button>
                  )}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    display: "flex",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#3B82F6" }}>{wetCount}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("overview.wet")}</div>
                  </div>
                  <div style={{ width: 1, background: "var(--border)" }} />
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#D97706" }}>{solidCount}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("overview.solid")}</div>
                  </div>
                  <div style={{ width: 1, background: "var(--border)" }} />
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{totalDiapers}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("overview.total")}</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("overview.noDiapers")}
              </div>
            )}
            {diapersByDay.some((d) => d.count > 0) && (
              <>
                <div style={{ marginTop: 16, height: 120 }} onTouchEnd={(event) => handleBarTouchEnd(event, "diaper", diapersByDay, "count")} onClick={blockSyntheticChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={diapersByDay} barSize={18} onClick={(data) => handleChartClick(data, "diaper", diapersByDay, "count")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" fill={colors.diaper} radius={[6, 6, 0, 0]} opacity={0.85} cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "diaper" && (
                  <ChartDetailBar
                    label={selectedBar.label}
                    value={selectedBar.value}
                    unit={t("overview.diaperChanges")}
                    color={colors.diaper}
                    onViewEntries={() => openDayModal(selectedBar.label, "diaper")}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            )}
          </SectionCard>
        </div>}

        {/* Tummy Time */}
        {isFeatureEnabled("tummy") && <div className="fade-in fade-in-6">
          <SectionCard title={t("overview.tummyTime")} icon={<Icons.Sun />} color={colors.tummy}>
            {tummyByDay.some((d) => d.minutes > 0) ? (
              <>
                <div style={{ height: 140 }} onTouchEnd={(event) => handleBarTouchEnd(event, "tummy", tummyByDay, "minutes")} onClick={blockSyntheticChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tummyByDay} barSize={22} onClick={(data) => handleChartClick(data, "tummy", tummyByDay, "minutes")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="minutes" fill={colors.tummy} radius={[6, 6, 0, 0]} opacity={0.8} cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "tummy" ? (
                  <ChartDetailBar
                    label={selectedBar.label}
                    value={selectedBar.value}
                    unit="min"
                    color={colors.tummy}
                    onViewEntries={() => openDayModal(selectedBar.label, "tummy")}
                    onDismiss={() => setSelectedBar(null)}
                  />
                ) : (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: `${colors.tummy}08`,
                      border: `1px solid ${colors.tummy}15`,
                    }}
                  >
                    <Icons.TrendUp />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {t("overview.avgPerSession", { value: Math.round(avgTummy) })}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("overview.noTummy")}
              </div>
            )}
          </SectionCard>
        </div>}
        {/* Pumping — data-gated like temperature/medications so families who
            don't pump (but leave the feature on) don't carry an empty card */}
        {isFeatureEnabled("pumping") && (pumpingTimeline.length > 0 || pumpingByDay.some((d) => d.amount > 0)) && <div className="fade-in fade-in-6">
          <SectionCard title={t("overview.recentPumping")} icon={<Icons.Bottle />} color={colors.pumping}>
            {pumpingTimeline.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(expanded.pumping ? pumpingTimeline : pumpingTimeline.slice(0, COLLAPSED_COUNT)).map((p, i, arr) => (
                  <div key={i} className="entry-clickable" onClick={() => onEditEntry?.("pumping", p.entry)}>
                    <TimelineItem
                      time={p.time}
                      label={p.label}
                      detail={p.detail}
                      color={colors.pumping}
                      isLast={i === arr.length - 1}
                      tags={tagMaps.pumping?.[p.entry?.id]}
                    />
                  </div>
                ))}
                {pumpingTimeline.length > COLLAPSED_COUNT && (
                  <button className="expand-toggle" onClick={() => toggle("pumping")}>
                    {expanded.pumping ? t("overview.showLess") : t("overview.showMore", { count: pumpingTimeline.length - COLLAPSED_COUNT })}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                {t("overview.noPumping")}
              </div>
            )}
            {pumpingByDay.some((d) => d.amount > 0) && (
              <>
                <div style={{ marginTop: 16, height: 120 }} onTouchEnd={(event) => handleBarTouchEnd(event, "pumping", pumpingByDay, "amount")} onClick={blockSyntheticChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pumpingByDay} barSize={18} onClick={(data) => handleChartClick(data, "pumping", pumpingByDay, "amount")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="amount" fill={colors.pumping} radius={[6, 6, 0, 0]} opacity={0.85} cursor="pointer" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "pumping" && (
                  <ChartDetailBar
                    label={selectedBar.label}
                    value={selectedBar.value}
                    unit={units.volume}
                    color={colors.pumping}
                    onViewEntries={() => openDayModal(selectedBar.label, "pumping")}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            )}
          </SectionCard>
        </div>}

        {/* Milk stock — opt-in (Settings > Preferences > Views) and, like the
            pumping card above, only useful with the pumping feature on */}
        {isViewEnabled("milkStock") && isFeatureEnabled("pumping") && <div className="fade-in fade-in-6">
          <MilkStock
            stock={milkStock}
            weeklyPumping={weeklyPumping}
            weeklyFeedings={weeklyFeedingsRaw}
            weeklyMilkWaste={weeklyMilkWaste}
            onEditEntry={onEditEntry}
            canWrite={canWrite}
          />
        </div>}

        {/* Temperature */}
        {isFeatureEnabled("temp") && temperatures && temperatures.length > 0 && (
          <div className="fade-in fade-in-7">
            <SectionCard title={t("overview.temperature")} icon={<Icons.Temp />} color={colors.temp}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(expanded.temps ? temperatures : temperatures.slice(0, 3)).map((temp, i, arr) => (
                  <div key={temp.id} className="entry-clickable" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 10, background: i === 0 ? `${colors.temp}08` : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => onEditEntry?.("temp", temp)}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: colors.temp }}>
                        {temp.temperature.toFixed(1)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                        {new Date(temp.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <TagChips tags={tagMaps.temperature?.[temp.id]} size="sm" />
                    </div>
                    {canWrite("temp") && <button className="delete-entry-btn" onClick={() => onDeleteEntry?.("temp", temp.id)} title={t("general.delete")}>x</button>}
                  </div>
                ))}
                {temperatures.length > 3 && (
                  <button className="expand-toggle" onClick={() => toggle("temps")}>
                    {expanded.temps ? t("overview.showLess") : t("overview.showMore", { count: temperatures.length - 3 })}
                  </button>
                )}
              </div>
            </SectionCard>
          </div>
        )}

        {/* Medications */}
        {isFeatureEnabled("medication") && medications && medications.length > 0 && (
          <div className="fade-in fade-in-8">
            <SectionCard title={t("overview.medications")} icon={<Icons.Temp />} color="#e67e22">
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(expanded.meds ? medications : medications.slice(0, 3)).map((m, i) => (
                  <div key={m.id} className="entry-clickable" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 10, background: i === 0 ? "#e67e2208" : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => onEditEntry?.("medication", m)}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e67e22" }}>{m.name}</span>
                      {m.dosage && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {m.dosage} {m.dosage_unit}
                        </span>
                      )}
                      <TagChips tags={tagMaps.medication?.[m.id]} size="sm" />
                      <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
                        {new Date(m.time).toLocaleTimeString(getDisplayLocale(), { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {canWrite("medication") && <button className="delete-entry-btn" onClick={() => onDeleteEntry?.("medication", m.id)} title={t("general.delete")}>x</button>}
                  </div>
                ))}
                {medications.length > 3 && (
                  <button className="expand-toggle" onClick={() => toggle("meds")}>
                    {expanded.meds ? t("overview.showLess") : t("overview.showMore", { count: medications.length - 3 })}
                  </button>
                )}
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      {/* Day Activities Modal */}
      {dayModal && (
        <DayActivitiesModal
          day={dayModal.day}
          type={dayModal.type}
          data={dayModal.data}
          onEditEntry={onEditEntry}
          onClose={() => setDayModal(null)}
        />
      )}
    </>
  );
}

function DiaperTypeToggle({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    ["total", t("overview.total")],
    ["wet", t("overview.wet")],
    ["solid", t("overview.solid")],
  ];

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }} role="group" aria-label={t("overview.diaperFilterLabel")}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: value === key ? colors.diaper : "var(--card-bg)",
            color: value === key ? "white" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SleepPeriodToggle({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    ["today", t("overview.sleepToday")],
    ["24h", t("overview.sleep24h")],
  ];

  return (
    <div
      role="group"
      aria-label={t("overview.sleepPeriodLabel")}
      style={{ display: "flex", gap: 6, marginTop: -2 }}
    >
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: value === key ? "#6C5CE7" : "var(--card-bg)",
            color: value === key ? "white" : "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
