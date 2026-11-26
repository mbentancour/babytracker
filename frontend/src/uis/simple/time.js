// Time helpers for the simple UI's quick-log sheets, which ask "when" as a
// clock time or "n minutes ago" instead of a full date and time.
import { QUICK_MINUTES, nursingLength } from "../../utils/sides";

// The API takes naive UTC timestamps ("YYYY-MM-DDTHH:MM:SS").
export function toUTC(date) {
  return date.toISOString().slice(0, 19);
}

// A feed or a pumping session logged after the fact, when all that is known is
// when, is recorded as a quarter of an hour ending then: the length the full
// form starts from. Every quick-log uses this, so the UIs write the same thing.
// `minutes` is its length when that was said too.
export function quickSpan(end, minutes = QUICK_MINUTES) {
  return { start: toUTC(new Date(end.getTime() - minutes * 60000)), end: toUTC(end) };
}

// nursingSpan is quickSpan for a breastfeed whose length was said: `length`
// is { minutes } for a feed on one side and { left, right } (minutes too) for
// one on both, which also saves how long each side took.
export function nursingSpan(end, method, length) {
  const { minutes, ...sides } = nursingLength(method, length);
  return { ...quickSpan(end, minutes), ...sides };
}

// "HH:MM" for a time input.
export function clock(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// lastClock turns a clock reading into the most recent moment it showed that
// time, at or before `before`. At 00:20, "23:40" means twenty to midnight
// yesterday, not tonight. Returns null for an unreadable value.
export function lastClock(hhmm, before) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!match) return null;
  const date = new Date(before);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (date > before) date.setDate(date.getDate() - 1);
  return date;
}

// A sleep nobody labelled is a nap when it starts between 07:00 and 19:00 and
// lasts under four hours — the rule the importers and the Home Assistant
// integration use.
export function isNapSleep(start, end) {
  const hour = start.getHours();
  return hour >= 7 && hour < 19 && end - start < 4 * 60 * 60 * 1000;
}
