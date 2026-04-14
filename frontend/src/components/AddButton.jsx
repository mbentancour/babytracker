/**
 * Small inline "+" button used in card headers and stat cards to add a new
 * entry of the relevant type. Color matches the section's accent.
 */
export default function AddButton({ onClick, color, label, size = 28 }) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      title={label || "Add"}
      aria-label={label || "Add"}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        border: "none",
        background: `${color}22`,
        color: color,
        fontSize: Math.round(size * 0.7),
        fontWeight: 300,
        lineHeight: 1,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      +
    </button>
  );
}
