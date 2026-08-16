import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import SectionCard from "./SectionCard";
import CustomTooltip from "./CustomTooltip";
import AddButton from "./AddButton";
import TimelineItem from "./TimelineItem";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { useUnits } from "../utils/units";
import { useI18n } from "../utils/i18n";
import { aggregateByDayOfWeek, stashOutflow, formatTime, timeAgo } from "../utils/formatters";

const RECENT_WASTE_COUNT = 3;

// MilkStock shows the expressed-milk balance: what went into the stash, what
// came out of it, and what's left.
//
// The headline figure comes from the server (`/api/milk-stock`) rather than
// from the rows on this page, because a stash is cumulative — summing the last
// seven days would answer a different, far less useful question. The chart
// underneath is the seven-day movement, which is what the local rows are for.
export default function MilkStock({
  stock,
  weeklyPumping = [],
  weeklyFeedings = [],
  weeklyMilkWaste = [],
  onEditEntry,
  canWrite = () => true,
}) {
  const units = useUnits();
  const { t } = useI18n();

  const pumpedByDay = aggregateByDayOfWeek(weeklyPumping, "amount");
  const fedByDay = aggregateByDayOfWeek(stashOutflow(weeklyFeedings), "amount");
  const wastedByDay = aggregateByDayOfWeek(weeklyMilkWaste, "amount", "time");

  const movement = pumpedByDay.map((d, i) => ({
    day: d.day,
    pumped: d.amount,
    bottleFed: fedByDay[i]?.amount || 0,
    discarded: wastedByDay[i]?.amount || 0,
  }));
  const hasMovement = movement.some((d) => d.pumped || d.bottleFed || d.discarded);

  const figures = [
    { key: "pumped", value: stock?.pumped, color: colors.pumping },
    { key: "bottleFed", value: stock?.bottle_fed, color: colors.feeding },
    { key: "discarded", value: stock?.discarded, color: colors.milkWaste },
    // A negative balance isn't an error — it means something isn't being
    // logged (nursing recorded as a bottle, pumping without amounts) — so it
    // is shown, flagged in the warning colour rather than clamped to zero.
    {
      key: "estimated",
      value: stock?.stock,
      color: stock && stock.stock < 0 ? colors.temp : colors.growth,
      emphasis: true,
    },
  ];

  const recentWaste = weeklyMilkWaste.slice(0, RECENT_WASTE_COUNT);

  return (
    <SectionCard
      title={t("milkStock.title")}
      icon={<Icons.Bottle />}
      color={colors.pumping}
      action={
        canWrite("pumping") ? (
          <AddButton
            onClick={() => onEditEntry?.("milkWaste")}
            color={colors.milkWaste}
            label={t("milkWaste.log")}
          />
        ) : undefined
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
          gap: 12,
          textAlign: "center",
        }}
      >
        {figures.map((f) => (
          <div key={f.key}>
            <div
              style={{
                color: f.color,
                fontWeight: 700,
                fontSize: f.emphasis ? 20 : 17,
                letterSpacing: "-0.01em",
              }}
            >
              {stock ? `${Math.round(f.value)} ${units.volume}` : "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {t(`milkStock.${f.key}`)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, textAlign: "center" }}>
        {t("milkStock.estimateHint")}
      </div>

      {hasMovement ? (
        <div style={{ marginTop: 16, height: 130 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={movement} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "var(--text-dim)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="pumped" name={t("milkStock.pumped")} fill={colors.pumping} radius={[5, 5, 0, 0]} />
              <Bar dataKey="bottleFed" name={t("milkStock.bottleFed")} fill={colors.feeding} radius={[5, 5, 0, 0]} />
              <Bar dataKey="discarded" name={t("milkStock.discarded")} fill={colors.milkWaste} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
          {t("milkStock.noMovement")}
        </div>
      )}

      {recentWaste.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
            {t("milkStock.recentWaste")}
          </div>
          {recentWaste.map((entry, i) => (
            <div
              key={entry.id}
              className="entry-clickable"
              onClick={() => onEditEntry?.("milkWaste", entry)}
            >
              <TimelineItem
                time={formatTime(entry.time)}
                label={`${entry.amount} ${units.volume}${entry.notes ? ` · ${entry.notes}` : ""}`}
                detail={timeAgo(entry.time, t)}
                color={colors.milkWaste}
                isLast={i === recentWaste.length - 1}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
