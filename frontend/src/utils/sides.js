// The two sides of one entry: how much each breast gave in a pumping session,
// and how long each took in a feed on both.
//
// Every UI works out what it saves, where its fields start and what it shows
// for them from here, so the same answers give the same entry whichever UI
// asked. Pure functions; text comes out through the translator passed in.

export const BOTH_BREASTS = "both breasts";
const ONE_SIDE = ["left breast", "right breast"];

// A feed logged after the fact with nothing said about its length: the
// quarter of an hour the full form starts from.
export const QUICK_MINUTES = 15;
// Each side of a feed on both, before anything is known about this family.
const SIDE_MINUTES = 10;
const LONGEST_MINUTES = 120;

const number = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
const time = (value) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

// sumSides adds up what the two breasts gave; a side that was not given
// counts as nothing. Rounded as the server rounds it, so 0.1 + 0.2 is 0.3.
export function sumSides(left, right) {
  return Math.round(((Number(left) || 0) + (Number(right) || 0)) * 1e4) / 1e4;
}

// pumpedSides is what each breast gave in a session logged side by side, or
// null for a session that only has a total.
export function pumpedSides(entry) {
  const left = number(entry?.amount_left);
  const right = number(entry?.amount_right);
  return left === null && right === null ? null : { left, right };
}

// nursedSides is how long each side took in a feed on both breasts, in
// seconds, or null for a feed that doesn't say.
export function nursedSides(entry) {
  if (entry?.method !== BOTH_BREASTS) return null;
  const left = number(entry.left_seconds);
  const right = number(entry.right_seconds);
  return left === null && right === null ? null : { left, right };
}

// pumpingAmounts is the amount a pumping session is saved with: its two
// sides when it was logged side by side (the server adds them up), otherwise
// its total. Nothing at all when nothing was measured.
export function pumpingAmounts({ split, amount, left, right }) {
  if (split) return left > 0 || right > 0 ? { amount_left: left, amount_right: right } : {};
  return amount > 0 ? { amount } : {};
}

// pumpingStart is where a pumping sheet's fields start: the last session
// with an amount, side by side if that is how it was logged. With nothing to
// go by it starts from `fallback`, as a total.
export function pumpingStart(sessions = [], fallback, step = 1) {
  let last = null;
  let lastAt = -Infinity;
  for (const session of sessions) {
    const at = time(session.end) ?? time(session.start);
    if (at !== null && at > lastAt && Number(session.amount) > 0) {
      last = session;
      lastAt = at;
    }
  }
  const amount = last ? Number(last.amount) : fallback;
  const sides = pumpedSides(last);
  if (sides) return { split: true, amount, left: sides.left ?? 0, right: sides.right ?? 0 };
  return { split: false, amount, ...halves(amount, step) };
}

// halves splits a total into two sides that add up to it, each a whole
// number of steps where the total allows.
export function halves(total, step = 1) {
  const left = Math.round(total / 2 / step) * step;
  return { left: +left.toFixed(2), right: +Math.max(0, total - left).toFixed(2) };
}

const minutesOf = (seconds) => Math.min(LONGEST_MINUTES, Math.max(1, Math.round(seconds / 60)));

// nursingStart is where the "how long" fields of a breastfeed start: the
// length of the last feed on one side, and the two sides of the last feed
// that was timed on both. A family's feeds are much alike from one to the
// next, so this is usually a tap or two from the answer.
export function nursingStart(feedings = []) {
  const start = { minutes: QUICK_MINUTES, left: SIDE_MINUTES, right: SIDE_MINUTES };
  let oneAt = -Infinity;
  let bothAt = -Infinity;
  for (const feed of feedings) {
    const from = time(feed.start);
    const to = time(feed.end);
    if (from === null || to === null) continue;
    if (ONE_SIDE.includes(feed.method) && to > oneAt) {
      const seconds = (to - from) / 1000 - (Number(feed.paused_seconds) || 0);
      // A feed with no length to speak of (an import, a mistaken tap) says
      // nothing about how long one takes.
      if (seconds >= 60) {
        oneAt = to;
        start.minutes = minutesOf(seconds);
      }
    }
    const sides = nursedSides(feed);
    if (sides && sides.left > 0 && sides.right > 0 && to > bothAt) {
      bothAt = to;
      start.left = minutesOf(sides.left);
      start.right = minutesOf(sides.right);
    }
  }
  return start;
}

// nursingLength is what the answer to "how long" comes to for a feed given
// by `method`: its length in minutes, and its two sides when it has them.
export function nursingLength(method, { minutes, left, right }) {
  if (method !== BOTH_BREASTS) return { minutes };
  return { minutes: left + right, left_seconds: Math.round(left * 60), right_seconds: Math.round(right * 60) };
}

function lengthText(seconds) {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// sidesText says what an entry's two sides were: "Left 40 mL · Right 50 mL"
// for a pumping session, "Left 10m · Right 8m" for a feed on both breasts.
// Null for an entry without sides. `volume` is the unit amounts are in.
export function sidesText(entry, { t, volume }) {
  const pumped = pumpedSides(entry);
  const nursed = pumped ? null : nursedSides(entry);
  const sides = pumped || nursed;
  if (!sides) return null;
  const say = (value) => (pumped ? `${value} ${volume}` : lengthText(value));
  return [
    sides.left !== null && `${t("sides.left")} ${say(sides.left)}`,
    sides.right !== null && `${t("sides.right")} ${say(sides.right)}`,
  ].filter(Boolean).join(" · ");
}
