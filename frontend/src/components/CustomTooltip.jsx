import { useUnits } from "../utils/units";

// `unit` is put after every value (a chart whose series are parts of one
// measure, such as millilitres per feeding type). `totalLabel` adds a last
// line with the sum of the parts when there is more than one.
export default function CustomTooltip({ active, payload, label, labelFormatter, unit, totalLabel }) {
  const units = useUnits();
  if (!active || !payload?.length) return null;
  const formattedLabel = labelFormatter ? labelFormatter(label) : label;
  return (
    <div
      style={{
        background: "var(--tooltip-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--text)",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{formattedLabel}</div>
      {payload.map((p, i) => (
        <div
          key={i}
          style={{
            color: p.color,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: p.color,
              display: "inline-block",
            }}
          />
          {p.name}: {p.value}
          {unit ? ` ${unit}` : p.name === "amount" ? ` ${units.volume}` : p.name === "minutes" ? " min" : p.name === "weight" ? ` ${units.weight}` : p.name === "height" ? ` ${units.length}` : ""}
        </div>
      ))}
      {totalLabel && payload.length > 1 && (
        <div style={{ marginTop: 2, paddingLeft: 14 }}>
          {totalLabel}: {Math.round(payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0) * 10) / 10}
          {unit ? ` ${unit}` : ""}
        </div>
      )}
    </div>
  );
}
