// What the Timeline UI knows about each kind of entry: which list it lives
// in, which permission guards it, its colour and icon, and how to save it.
//
// `tone` is the colour of a kind's badge. The badges are solid with a white
// icon, so a few tones are a shade deeper than the app's chart colours, which
// were picked to sit on a dark background rather than behind white.
import { api } from "../../api";
import { colors } from "../../utils/colors";
import { BREAST_METHODS } from "../../utils/preferences";
import { Glyph } from "./icons";

export const KINDS = {
  feeding: {
    list: "feedings", feature: "feeding", tags: "feeding", tone: "#EC8A09", span: true,
    create: (body) => api.createFeeding(body), update: (id, body) => api.updateFeeding(id, body), remove: (id) => api.deleteFeeding(id),
  },
  sleep: {
    list: "sleeps", feature: "sleep", tags: "sleep", tone: colors.sleep, span: true,
    create: (body) => api.createSleep(body), update: (id, body) => api.updateSleep(id, body), remove: (id) => api.deleteSleep(id),
  },
  diaper: {
    list: "changes", feature: "diaper", tags: "diaper", tone: colors.diaper,
    create: (body) => api.createChange(body), update: (id, body) => api.updateChange(id, body), remove: (id) => api.deleteChange(id),
  },
  tummy: {
    list: "tummyTimes", feature: "tummy", tags: "tummy_time", tone: colors.tummy, span: true,
    create: (body) => api.createTummyTime(body), update: (id, body) => api.updateTummyTime(id, body), remove: (id) => api.deleteTummyTime(id),
  },
  pumping: {
    list: "pumping", feature: "pumping", tags: "pumping", tone: colors.pumping, span: true,
    create: (body) => api.createPumping(body), update: (id, body) => api.updatePumping(id, body), remove: (id) => api.deletePumping(id),
  },
  // Uneaten milk has no permission of its own (it rides on pumping) and only
  // exists for households that switched the milk-stock view on.
  milkWaste: {
    list: "milkWaste", feature: "pumping", view: "milkStock", tone: "#64748B",
    update: (id, body) => api.updateMilkWaste(id, body), remove: (id) => api.deleteMilkWaste(id),
  },
  temp: {
    list: "temperatures", feature: "temp", tags: "temperature", tone: colors.temp,
    update: (id, body) => api.updateTemperature(id, body), remove: (id) => api.deleteTemperature(id),
  },
  medication: {
    list: "medications", feature: "medication", tags: "medication", tone: "#E67E22",
    update: (id, body) => api.updateMedication(id, body), remove: (id) => api.deleteMedication(id),
  },
  note: {
    list: "notes", feature: "note", tags: "note", tone: "#65A30D",
    update: (id, body) => api.updateNote(id, body), remove: (id) => api.deleteNote(id),
  },
  // Measurements and milestones belong to a date, not a time of day.
  weight: { list: "weights", feature: "weight", tags: "weight", tone: colors.growth, dated: true },
  height: { list: "heights", feature: "height", tags: "height", tone: colors.height, dated: true },
  headcirc: { list: "headCircumferences", feature: "headcirc", tags: "head_circumference", tone: colors.growth, dated: true },
  bmi: { list: "bmiEntries", feature: "bmi", tags: "bmi", tone: "#0EA5A4", dated: true },
  milestone: { list: "milestones", feature: "milestone", tags: "milestone", tone: "#00B894", dated: true },
};

export const toneOf = (kind) => KINDS[kind]?.tone || "#64748B";

const ICONS = {
  diaper: Glyph.Drop,
  tummy: Glyph.Tummy,
  pumping: Glyph.Pump,
  milkWaste: Glyph.BottleOff,
  temp: Glyph.Temp,
  medication: Glyph.Pill,
  note: Glyph.Note,
  weight: Glyph.Scale,
  height: Glyph.Ruler,
  headcirc: Glyph.Head,
  bmi: Glyph.Trend,
  milestone: Glyph.Flag,
};

// feedingIcon tells a bottle from the breast from a spoon at a glance.
export function feedingIcon(entry) {
  if (entry?.type === "solid food") return Glyph.Spoon;
  if (BREAST_METHODS.includes(entry?.method)) return Glyph.Nursing;
  return Glyph.Bottle;
}

// iconOf picks the icon for a kind, or for one row of the stream: a sleep is
// a moon where it starts and a sunrise where it ends.
export function iconOf(kind, { entry, part } = {}) {
  if (kind === "feeding") return feedingIcon(entry);
  if (kind === "sleep") return part === "end" ? Glyph.Sunrise : Glyph.Moon;
  return ICONS[kind] || Glyph.Note;
}
