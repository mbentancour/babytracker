import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { buildWHOCurves, mapMeasurementsToAge, ageInMonths } from "../utils/whoPercentiles";
import { useI18n } from "../utils/i18n";

/**
 * Overlay a child's measurements on top of WHO percentile curves.
 *
 * Props:
 *   metric: "weight" | "height" | "headcirc"
 *   sex: "male" | "female"
 *   birthDate: ISO date string
 *   entries: child's measurements (ordered by date)
 *   valueField: field name holding the numeric value
 *   unit: unit label (e.g. "kg", "cm")
 *   color: line color for the child's curve
 */
export default function WHOGrowthChart({
  metric,
  sex,
  birthDate,
  entries,
  valueField,
  unit,
  color,
}) {
  const { t } = useI18n();
  const childPoints = mapMeasurementsToAge(entries || [], valueField, birthDate);

  // Adaptive X-axis: show a window appropriate for the child's age and data range.
  // Min 6 months so early curves are readable, max 60 months (WHO data limit).
  const currentAge = birthDate ? ageInMonths(birthDate, new Date()) : 0;
  const lastDataAge = childPoints[childPoints.length - 1]?.ageMonths || 0;
  const dataMaxAge = Math.max(currentAge, lastDataAge);
  const maxAge = Math.min(60, Math.max(6, Math.ceil(dataMaxAge * 1.3)));

  // Use finer step for small ranges so curves render smoothly
  const step = maxAge <= 12 ? 0.5 : 1;

  // Build a unified set of ages: regular curve grid + every child point's exact age.
  // This way every child measurement gets its own row in the data array (no snapping,
  // no duplicates dropped, last point always present).
  const ageSet = new Set();
  for (let m = 0; m <= maxAge; m += step) ageSet.add(Math.round(m * 1000) / 1000);
  for (const p of childPoints) {
    if (p.ageMonths >= 0 && p.ageMonths <= maxAge) {
      ageSet.add(Math.round(p.ageMonths * 1000) / 1000);
    }
  }
  const allAges = [...ageSet].sort((a, b) => a - b);

  // Compute percentiles at every age (including child point ages) so the curves stay smooth.
  const curves = buildWHOCurves(metric, sex, 0, maxAge, step);
  if (curves.length === 0) {
    return (
      <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
        {t("growth.whoNoData")}
      </div>
    );
  }

  // Index curves by ageMonths for quick lookup; for child-point ages between curve x's,
  // build a per-age percentile via linear interpolation between adjacent curve points.
  const curvesByAge = new Map(curves.map((c) => [c.ageMonths, c]));
  const interpAt = (age) => {
    if (curvesByAge.has(age)) return curvesByAge.get(age);
    // Find bracketing curve points
    let lo = curves[0], hi = curves[curves.length - 1];
    for (let i = 0; i < curves.length - 1; i++) {
      if (curves[i].ageMonths <= age && curves[i + 1].ageMonths >= age) {
        lo = curves[i]; hi = curves[i + 1]; break;
      }
    }
    const f = hi.ageMonths === lo.ageMonths ? 0 : (age - lo.ageMonths) / (hi.ageMonths - lo.ageMonths);
    return {
      ageMonths: age,
      p3: lo.p3 + (hi.p3 - lo.p3) * f,
      p15: lo.p15 + (hi.p15 - lo.p15) * f,
      p50: lo.p50 + (hi.p50 - lo.p50) * f,
      p85: lo.p85 + (hi.p85 - lo.p85) * f,
      p97: lo.p97 + (hi.p97 - lo.p97) * f,
    };
  };

  const data = allAges.map((age) => {
    const c = interpAt(age);
    const child = childPoints.find((p) => Math.abs(p.ageMonths - age) < 0.001);
    return { ...c, child: child ? child[valueField] : null };
  });

  const tickFormat = (months) => {
    if (months < 24) return `${months}m`;
    const years = months / 12;
    return years % 1 === 0 ? `${years}y` : `${years.toFixed(1)}y`;
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--text)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {t("growth.ageLabel", { age: tickFormat(label) })}
        </div>
        {payload
          .filter((p) => p.value != null)
          .map((p) => (
            <div key={p.dataKey} style={{ color: p.color }}>
              {p.dataKey === "child"
                ? t("growth.childMeasurement")
                : `P${p.dataKey.replace("p", "")}`}
              : {p.value} {unit}
            </div>
          ))}
      </div>
    );
  };

  return (
    <div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="ageMonths"
            type="number"
            domain={[0, maxAge]}
            tickFormatter={tickFormat}
            tick={{ fontSize: 11, fill: "var(--text-dim)" }}
            axisLine={false}
            tickLine={false}
            label={{ value: t("growth.ageAxisLabel"), position: "insideBottom", offset: -5, fontSize: 11, fill: "var(--text-dim)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-dim)" }}
            axisLine={false}
            tickLine={false}
            label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--text-dim)" }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Percentile curves (dashed lines) */}
          <Line type="monotone" dataKey="p3"  name="P3"  stroke="#e74c3c" strokeWidth={1} strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="p15" name="P15" stroke="#f39c12" strokeWidth={1} strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="p50" name="P50" stroke="#00b894" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="p85" name="P85" stroke="#f39c12" strokeWidth={1} strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="p97" name="P97" stroke="#e74c3c" strokeWidth={1} strokeDasharray="4 4" dot={false} />

          {/* Child's measurements: line connecting dots, skipping null cells */}
          <Line
            type="monotone"
            dataKey="child"
            name={t("growth.childMeasurement")}
            stroke={color}
            strokeWidth={2.5}
            dot={{ fill: color, r: 4 }}
            activeDot={{ r: 6 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.4 }}>
        {t("growth.whoDisclaimer")}
      </div>
    </div>
  );
}
