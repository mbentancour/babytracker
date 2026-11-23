import AddButton from "./AddButton";

// keepFoot holds the space for the `foot` line even when there is nothing to
// put in it, so a card with no entries yet is as tall as its neighbours.
export default function StatCard({ icon, label, value, sub, foot, keepFoot, color, accent, onAdd, addLabel }) {
  return (
    <div
      style={{
        background: "var(--card-bg)",
        borderRadius: 16,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: "1px solid var(--border)",
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
        // Fill the grid cell, so cards sharing a row end level.
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: accent || color,
          opacity: 0.06,
        }}
      />
      {onAdd && (
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1 }}>
          <AddButton onClick={onAdd} color={color} label={addLabel} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: `${color}18`,
            color: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontWeight: 500,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "var(--text)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        // A fixed-height row: `sub` is a line of text on most cards but a pair
        // of buttons on the sleep card, and the two would otherwise differ.
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -2, minHeight: 26, display: "flex", alignItems: "center" }}>
          {sub}
        </div>
      )}
      {/* How long ago this last happened. In the card's own colour rather than
          the muted grey of `sub`, because at 3am it's the line you're actually
          looking for. */}
      {(foot || keepFoot) && (
        <div style={{ fontSize: 12, fontWeight: 600, color, marginTop: -2, minHeight: 16 }}>
          {foot}
        </div>
      )}
    </div>
  );
}
