import { useState } from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import SectionCard from "../components/SectionCard";
import CustomTooltip from "../components/CustomTooltip";
import ChartDetailBar from "../components/ChartDetailBar";
import DayActivitiesModal from "../components/DayActivitiesModal";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import { useUnits } from "../utils/units";
import { toGrowthSeries, formatGrowthTick, dailyFeedingTotals, dailySleepTotals, getEntriesForDate } from "../utils/formatters";
import { usePreferences } from "../utils/preferences";

export default function GrowthTab({ weights, heights, headCircumferences = [], bmiEntries = [], monthlyFeedings, monthlySleep, childBirthDate, onEditEntry, onDeleteEntry }) {
  const units = useUnits();
  const { prefs } = usePreferences();
  const [dayModal, setDayModal] = useState(null);
  const [selectedBar, setSelectedBar] = useState(null);
  const weightSeries = toGrowthSeries(weights, "weight");
  const heightSeries = toGrowthSeries(heights, "height");
  const headCircSeries = toGrowthSeries(headCircumferences, "head_circumference");
  const feedingSeries = dailyFeedingTotals(monthlyFeedings);
  const sleepSeries = dailySleepTotals(monthlySleep);

  const latestWeight = weights[0];
  const latestHeight = heights[0];
  const latestHeadCirc = headCircumferences[0];

  // BMI: prefer manual entry, fall back to calculated if auto-calculate is enabled
  const latestManualBMI = bmiEntries[0];
  const calculatedBMI = latestWeight && latestHeight && latestHeight.height > 0
    ? (latestWeight.weight / ((latestHeight.height / 100) ** 2)).toFixed(1)
    : null;

  const bmi = latestManualBMI
    ? { value: latestManualBMI.bmi.toFixed(1), source: "manual", date: latestManualBMI.date }
    : prefs.autoCalculateBMI && calculatedBMI
      ? { value: calculatedBMI, source: "calculated", date: null }
      : null;

  // Build BMI series for chart: combine manual entries with calculated fill-ins
  const bmiSeries = (() => {
    const manual = toGrowthSeries(bmiEntries, "bmi");
    if (!prefs.autoCalculateBMI) return manual;

    // Build a set of dates that have manual entries
    const manualDates = new Set(manual.map((m) => m.dateStr));

    // Calculate BMI for each weight entry that doesn't have a manual BMI
    const calculated = [];
    for (const w of weights) {
      const wDate = (w.date || "").slice(0, 10);
      if (manualDates.has(wDate)) continue;
      // Find closest height
      const h = heights.find((h) => h.date <= w.date) || heights[0];
      if (h && h.height > 0) {
        const bmiVal = w.weight / ((h.height / 100) ** 2);
        calculated.push({
          timestamp: new Date(wDate).getTime(),
          bmi: parseFloat(bmiVal.toFixed(1)),
          dateStr: wDate,
          entry: null,
        });
      }
    }

    return [...manual, ...calculated].sort((a, b) => a.timestamp - b.timestamp);
  })();

  // Compute averages for stat cards
  const feedingDays = feedingSeries.filter((d) => d.amount > 0);
  const avgFeeding = feedingDays.length
    ? Math.round(feedingDays.reduce((s, d) => s + d.amount, 0) / feedingDays.length)
    : 0;
  const sleepDays = sleepSeries.filter((d) => d.hours > 0);
  const avgSleep = sleepDays.length
    ? (sleepDays.reduce((s, d) => s + d.hours, 0) / sleepDays.length).toFixed(1)
    : 0;

  const handleChartClick = (data, type) => {
    if (!data || !data.activePayload?.[0]) return;
    const payload = data.activePayload[0];
    const label = data.activeLabel;
    const value = payload.value;
    const entry = payload.payload?.entry;
    setSelectedBar({ type, label, value, entry });
  };

  const openDayModal = (dateLabel, type) => {
    let dayData = [];
    if (type === "feeding") {
      dayData = getEntriesForDate(monthlyFeedings, dateLabel, "start");
    } else if (type === "sleep") {
      dayData = getEntriesForDate(monthlySleep, dateLabel, "start");
    }
    setSelectedBar(null);
    setDayModal({ day: dateLabel, type, data: dayData });
  };

  return (
    <>
      {/* Latest Measurements */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div className="fade-in fade-in-1">
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: 16,
              padding: "20px 22px",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: `${colors.growth}18`,
                  color: colors.growth,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icons.Weight />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Weight
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {latestWeight ? `${latestWeight.weight} ${units.weight}` : "—"}
            </div>
            {latestWeight && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(latestWeight.date).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        <div className="fade-in fade-in-2">
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: 16,
              padding: "20px 22px",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: `${colors.height}18`,
                  color: colors.height,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icons.Ruler />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Height
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {latestHeight ? `${latestHeight.height} ${units.length}` : "—"}
            </div>
            {latestHeight && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(latestHeight.date).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        <div className="fade-in fade-in-3">
          <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "20px 22px", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${colors.growth}18`, color: colors.growth, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icons.Baby />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em" }}>Head Circ.</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {latestHeadCirc ? `${latestHeadCirc.head_circumference} ${units.length}` : "—"}
            </div>
            {latestHeadCirc && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(latestHeadCirc.date).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        <div className="fade-in fade-in-4">
          <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "20px 22px", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${colors.feeding}18`, color: colors.feeding, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icons.TrendUp />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.03em" }}>BMI</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
              {bmi ? bmi.value : "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {bmi
                ? bmi.source === "manual"
                  ? `Doctor value · ${new Date(bmi.date).toLocaleDateString()}`
                  : `Calculated from ${latestWeight.weight} ${units.weight} / ${latestHeight.height} ${units.length}`
                : "No data"}
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {/* Daily Feeding Totals */}
        <div className="fade-in fade-in-5">
          <SectionCard title="Daily Feeding (30d)" icon={<Icons.Bottle />} color={colors.feeding}>
            {feedingSeries.some((d) => d.amount > 0) ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={feedingSeries} onClick={(data) => handleChartClick(data, "feeding")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke={colors.feeding}
                        strokeWidth={2}
                        fill={`${colors.feeding}30`}
                        dot={false}
                        activeDot={{ r: 4, fill: colors.feeding, cursor: "pointer" }}
                        cursor="pointer"
                      />
                    </AreaChart>
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
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                No feeding data recorded yet
              </div>
            )}
          </SectionCard>
        </div>

        {/* Daily Sleep Totals */}
        <div className="fade-in fade-in-6">
          <SectionCard title="Daily Sleep (30d)" icon={<Icons.Moon />} color={colors.sleep}>
            {sleepSeries.some((d) => d.hours > 0) ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sleepSeries} onClick={(data) => handleChartClick(data, "sleep")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="hours"
                        stroke={colors.sleep}
                        strokeWidth={2}
                        fill={`${colors.sleep}30`}
                        dot={false}
                        activeDot={{ r: 4, fill: colors.sleep, cursor: "pointer" }}
                        cursor="pointer"
                      />
                    </AreaChart>
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
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                No sleep data recorded yet
              </div>
            )}
          </SectionCard>
        </div>

        {/* Weight Chart */}
        <div className="fade-in fade-in-7">
          <SectionCard title="Weight Trend" icon={<Icons.Weight />} color={colors.growth}>
            {weightSeries.length >= 2 ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weightSeries} onClick={(data) => handleChartClick(data, "weight")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatGrowthTick} tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip labelFormatter={formatGrowthTick} />} />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke={colors.growth}
                        strokeWidth={2.5}
                        dot={{ fill: colors.growth, r: 4, cursor: "pointer" }}
                        activeDot={{ r: 6, cursor: "pointer" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "weight" && (
                  <ChartDetailBar
                    label={formatGrowthTick(selectedBar.label)}
                    value={selectedBar.value}
                    unit={units.weight}
                    color={colors.growth}
                    actionLabel="Edit"
                    onViewEntries={() => {
                      if (selectedBar.entry) onEditEntry?.("weight", selectedBar.entry);
                      setSelectedBar(null);
                    }}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                {weightSeries.length === 1 ? "Need at least 2 measurements to show trend" : "No weight data recorded yet"}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Height Chart */}
        <div className="fade-in fade-in-8">
          <SectionCard title="Height Trend" icon={<Icons.Ruler />} color={colors.height}>
            {heightSeries.length >= 2 ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={heightSeries} onClick={(data) => handleChartClick(data, "height")}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                      <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatGrowthTick} tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip labelFormatter={formatGrowthTick} />} />
                      <Line
                        type="monotone"
                        dataKey="height"
                        stroke={colors.height}
                        strokeWidth={2.5}
                        dot={{ fill: colors.height, r: 4, cursor: "pointer" }}
                        activeDot={{ r: 6, cursor: "pointer" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {selectedBar?.type === "height" && (
                  <ChartDetailBar
                    label={formatGrowthTick(selectedBar.label)}
                    value={selectedBar.value}
                    unit={units.length}
                    color={colors.height}
                    actionLabel="Edit"
                    onViewEntries={() => {
                      if (selectedBar.entry) onEditEntry?.("height", selectedBar.entry);
                      setSelectedBar(null);
                    }}
                    onDismiss={() => setSelectedBar(null)}
                  />
                )}
              </>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                {heightSeries.length === 1 ? "Need at least 2 measurements to show trend" : "No height data recorded yet"}
              </div>
            )}
          </SectionCard>
        </div>
        {/* Head Circumference Chart */}
        <div className="fade-in fade-in-9">
          <SectionCard title="Head Circumference" icon={<Icons.Baby />} color={colors.growth}>
            {headCircSeries.length >= 2 ? (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={headCircSeries} onClick={(data) => handleChartClick(data, "headcirc")}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                    <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatGrowthTick} tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip content={<CustomTooltip labelFormatter={formatGrowthTick} />} />
                    <Line type="monotone" dataKey="head_circumference" stroke={colors.growth} strokeWidth={2.5} dot={{ fill: colors.growth, r: 4, cursor: "pointer" }} activeDot={{ r: 6, cursor: "pointer" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                {headCircSeries.length === 1 ? "Need at least 2 measurements to show trend" : "No head circumference data recorded yet"}
              </div>
            )}
          </SectionCard>
        </div>

        {/* BMI Chart */}
        <div className="fade-in fade-in-10">
          <SectionCard title="BMI Trend" icon={<Icons.TrendUp />} color={colors.feeding}>
            {bmiSeries.length >= 2 ? (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bmiSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#252836" vertical={false} />
                    <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatGrowthTick} tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#5A6178" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip content={<CustomTooltip labelFormatter={formatGrowthTick} />} />
                    <Line type="monotone" dataKey="bmi" stroke={colors.feeding} strokeWidth={2.5} dot={{ fill: colors.feeding, r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
                {bmiSeries.length === 1 ? "Need at least 2 data points to show trend" : "No BMI data yet"}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

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
