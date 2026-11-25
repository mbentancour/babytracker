// ChartKey says which colour is which under a chart whose series are parts of
// one thing (feeding types, night sleep and naps): `items` are
// { color, label }. With fewer than two there is nothing to tell apart.
export default function ChartKey({ items }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-key" style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
      {items.map((item) => (
        <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
