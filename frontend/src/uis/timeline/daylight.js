// The sky, as a function of the time of day.
//
// The Timeline UI's header is the sky as it is right now: blue at noon, warm
// at sunrise and sunset, dark with stars at night. It is decoration with a
// job — a phone picked up for a 3 a.m. feed opens dark — and it makes the
// screen look like the time it is. Inside it, a narrow strip shows the last
// 24 hours in the same colours, so you can see at once which sleep was the
// night and which feeds happened in the small hours.
//
// Everything here is pure and takes times as epoch milliseconds, read in the
// browser's local timezone. Sunrise and sunset are fixed (07:00 and 19:00, the
// same boundary the rest of the app uses for "night"), not computed from a
// location the app doesn't know.

const HOUR = 3600000;

// Hour of day, then three colours: high in the sky, at the horizon, and for
// that hour on the 24-hour strip. Every one is dark enough for white text.
const KEYS = [
  [0, "#0B1033", "#1B2356", "#141C4E"],
  [5, "#101845", "#2A2D6E", "#1B2259"],
  [6.25, "#2B2F7C", "#A9567F", "#6B4A9C"],
  [7, "#3A5DB8", "#EE9A69", "#F2A26C"],
  [8.5, "#2470CE", "#58A5EA", "#58A4EA"],
  [12, "#1E66C8", "#4C9AE6", "#4897E7"],
  [16.5, "#2470CE", "#5BA7EB", "#58A4EA"],
  [18.25, "#3F59BE", "#EE9F69", "#F4A46A"],
  [19, "#4B3E9C", "#E46E5E", "#EA7260"],
  [20, "#2A2874", "#7C4688", "#5B3D92"],
  [21.5, "#0F1640", "#232764", "#19215B"],
  [24, "#0B1033", "#1B2356", "#141C4E"],
];
const LAYERS = ["high", "horizon", "strip"];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (parts) => `#${parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function mix(a, b, amount) {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * amount));
}

const hourOf = (ms) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const ramp = (value, from, to) => Math.max(0, Math.min(1, (value - from) / (to - from)));

// nightness is 1 in the dead of night, 0 in full daylight, and in between
// while the sun comes up or goes down.
export function nightness(ms) {
  const h = hourOf(ms);
  if (h < 12) return 1 - ramp(h, 5.5, 8);
  return ramp(h, 18.5, 21);
}

// skyAt gives the sky's colours at one moment: { high, horizon, strip }.
export function skyAt(ms) {
  const h = hourOf(ms);
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] < h) i++;
  const [h0, ...from] = KEYS[i - 1];
  const [h1, ...to] = KEYS[i];
  const amount = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
  return Object.fromEntries(LAYERS.map((layer, n) => [layer, mix(from[n], to[n], amount)]));
}

// skyStops lists the gradient stops for a strip of sky covering [from, to]:
// one at each end, and one wherever a key moment of the day falls inside.
// `pos` runs 0..1 along the strip.
export function skyStops(from, to) {
  const span = to - from;
  if (!(span > 0)) return [];
  const stops = [{ pos: 0, ...skyAt(from) }];
  const day = new Date(startOfDay(from));
  // Step by calendar day, so a clock change can't shift the key moments.
  for (; day.getTime() < to; day.setDate(day.getDate() + 1)) {
    for (const [h, ...colours] of KEYS) {
      const at = new Date(day);
      at.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
      const ms = at.getTime();
      if (ms > from && ms < to) {
        stops.push({ pos: (ms - from) / span, ...Object.fromEntries(LAYERS.map((layer, n) => [layer, colours[n]])) });
      }
    }
  }
  stops.push({ pos: 1, ...skyAt(to) });
  return stops.sort((a, b) => a.pos - b.pos);
}

// gradient turns stops into a CSS background, left to right, for one layer.
export function gradient(stops, layer) {
  if (!stops.length) return "none";
  return `linear-gradient(90deg, ${stops.map((s) => `${s[layer]} ${(s.pos * 100).toFixed(2)}%`).join(", ")})`;
}

// hourMarks are the whole hours inside [from, to] that fall on a multiple of
// `step`, with where they sit on the strip. Noon and midnight are flagged so
// the strip can draw a sun and a moon there instead of a number.
export function hourMarks(from, to, step = 6) {
  const span = to - from;
  const marks = [];
  if (!(span > 0)) return marks;
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  for (let ms = first.getTime(); ms <= to; ms += HOUR) {
    if (ms < from) continue;
    const hour = new Date(ms).getHours();
    if (hour % step !== 0) continue;
    marks.push({ pos: (ms - from) / span, ms, hour, kind: hour === 12 ? "noon" : hour === 0 ? "midnight" : "hour" });
  }
  return marks;
}

// stars is a fixed scatter of points (x and y in 0..1) for the night parts of
// the strip. Seeded, so the sky doesn't reshuffle on every render.
export function stars(count = 36, seed = 7) {
  let state = seed >>> 0;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let v = state;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: next(),
    y: next() * 0.7,
    size: next() > 0.8 ? 2 : 1.4,
    glow: 0.35 + next() * 0.65,
  }));
}

// span places [start, end] on a strip covering [from, to] as { left, width }
// in 0..1, clipped to the strip; null when it lies outside.
export function span(start, end, from, to) {
  const total = to - from;
  if (!(total > 0) || end <= from || start >= to) return null;
  const left = (Math.max(start, from) - from) / total;
  const right = (Math.min(end, to) - from) / total;
  return { left, width: right - left };
}
