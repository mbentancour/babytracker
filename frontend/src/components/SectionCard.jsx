// The card fills its grid cell, so cards sharing a row end level. With `fill`
// the body is a column too, which lets a child push itself to the bottom of
// the card with `marginTop: "auto"` (the Overview pins its weekly charts so).
export default function SectionCard({ title, icon, children, color, action, fill }) {
  return (
    <div
      style={{
        background: "var(--card-bg)",
        borderRadius: 16,
        border: "1px solid var(--border)",
        overflow: "hidden",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `${color}15`,
            color: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            flex: 1,
          }}
        >
          {title}
        </span>
        {action && <div>{action}</div>}
      </div>
      <div style={{ padding: "16px 20px", flex: 1, ...(fill ? { display: "flex", flexDirection: "column" } : null) }}>{children}</div>
    </div>
  );
}
