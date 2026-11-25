// The class names (and --tone, the card's colour) are hooks for a UI that
// wants to restyle the card; the card's own look is the inline styles below.
//
// The card fills its grid cell, so cards sharing a row end level. With `fill`
// the body is a column too, which lets a child push itself to the bottom of
// the card with `marginTop: "auto"` (the Overview pins its weekly charts so).
export default function SectionCard({ title, icon, children, color, action, fill }) {
  return (
    <div
      className="section-card"
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
        className="section-card-head"
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          className="section-card-icon"
          style={{
            "--tone": color,
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
          className="section-card-title"
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
      <div className="section-card-body" style={{ padding: "16px 20px", flex: 1, ...(fill ? { display: "flex", flexDirection: "column" } : null) }}>{children}</div>
    </div>
  );
}
