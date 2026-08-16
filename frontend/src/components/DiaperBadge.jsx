import { useI18n } from "../utils/i18n";

const LABEL_KEYS = { wet: "diaper.wet", solid: "diaper.solid", both: "diaper.both" };

export default function DiaperBadge({ type }) {
  const { t } = useI18n();
  const bg =
    type === "solid" ? "#D97706" : type === "both" ? "#8B5CF6" : "#3B82F6";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 6,
        background: `${bg}18`,
        color: bg,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {LABEL_KEYS[type] ? t(LABEL_KEYS[type]) : type}
    </span>
  );
}
