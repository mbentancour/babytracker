// What can be logged and timed, shared by every UI: the actions and their
// grouping, the timer kinds, and the few rules attached to them. A UI decides
// how to present these; it should not need its own copy of the list.
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import { formatTime } from "../utils/formatters";

export const ACTION_GROUPS = [
  {
    id: "track",
    labelKey: "action.track",
    actions: [
      { id: "feeding", labelKey: "action.feeding", icon: <Icons.Bottle />, color: colors.feeding },
      { id: "sleep", labelKey: "action.sleep", icon: <Icons.Moon />, color: colors.sleep },
      { id: "diaper", labelKey: "action.diaper", icon: <Icons.Droplet />, color: colors.diaper },
      { id: "tummy", labelKey: "action.tummy", icon: <Icons.Sun />, color: colors.tummy },
      { id: "pumping", labelKey: "action.pumping", icon: <Icons.Bottle />, color: colors.pumping },
      // Rides on the pumping permission (it has no RBAC feature of its own)
      // and only appears when the milk-stock view is switched on, since
      // logging discards is pointless without a balance to subtract from.
      { id: "milkWaste", labelKey: "action.milkWaste", icon: <Icons.BottleOff />, color: colors.milkWaste, feature: "pumping", view: "milkStock" },
    ],
  },
  {
    id: "measure",
    labelKey: "action.measure",
    actions: [
      { id: "temp", labelKey: "action.temp", icon: <Icons.Temp />, color: colors.temp },
      { id: "weight", labelKey: "action.weight", icon: <Icons.Weight />, color: colors.growth },
      { id: "height", labelKey: "action.height", icon: <Icons.Ruler />, color: colors.height },
      { id: "headcirc", labelKey: "action.headCirc", icon: <Icons.Baby />, color: colors.growth },
      { id: "bmi", labelKey: "action.bmi", icon: <Icons.TrendUp />, color: colors.feeding },
    ],
  },
  {
    id: "more",
    labelKey: "action.more",
    actions: [
      { id: "note", labelKey: "action.note", icon: <Icons.StickyNote />, color: colors.note },
      { id: "medication", labelKey: "action.medication", icon: <Icons.Temp />, color: "#e67e22" },
      { id: "milestone", labelKey: "action.milestone", icon: <Icons.TrendUp />, color: "#00b894" },
    ],
  },
];

// Entry types whose permission lives under another feature. Uneaten milk is
// gated by the pumping permission server-side (see internal/models/access.go
// and pathFeatureMap in internal/middleware/rbac.go), so the client has to ask
// the same question or the edit forms silently refuse to open.
const ENTRY_FEATURE_OVERRIDES = { milkWaste: "pumping" };
export const entryFeature = (type) => ENTRY_FEATURE_OVERRIDES[type] || type;

export const formatPauses = (pauses) => {
  if (!pauses || pauses.length === 0) return "";
  const completedPauses = pauses.filter((p) => p.start && p.end);
  if (completedPauses.length === 0) return "";
  return completedPauses
    .map((p) => `${formatTime(p.start)}-${formatTime(p.end)}`)
    .join(", ");
};

export const TIMER_TYPES = [
  { id: "feeding", labelKey: "timer.feeding", icon: <Icons.Bottle />, color: colors.feeding },
  { id: "sleep", labelKey: "timer.sleep", icon: <Icons.Moon />, color: colors.sleep },
  { id: "tummy", labelKey: "timer.tummy", icon: <Icons.Sun />, color: colors.tummy },
];

export function timerNameToType(name) {
  if (!name) return "feeding";
  const n = name.toLowerCase();
  if (n.includes("sleep")) return "sleep";
  if (n.includes("tummy")) return "tummy";
  return "feeding";
}

export function getTimerLabel(name, tr) {
  // Only the app's own timer kinds get a translated label; a custom name
  // created through the API is shown verbatim.
  const n = (name || "").toLowerCase();
  if (!n.includes("feed") && !n.includes("sleep") && !n.includes("tummy")) return name;
  const timer = TIMER_TYPES.find((t) => t.id === timerNameToType(name));
  return timer ? tr(timer.labelKey) : name;
}
