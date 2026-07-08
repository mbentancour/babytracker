export function getAge(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  const days = now.getDate() - birth.getDate();
  if (days < 0) months--;
  const adjustedDays = days < 0 ? 30 + days : days;
  if (months < 1)
    return `${Math.max(0, Math.floor((now - birth) / 86400000))} days`;
  if (months < 12)
    return `${months}mo ${adjustedDays}d`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0)
    return `${years}y`;
  return `${years}y ${remainingMonths}mo`;
}

export function formatElapsed(seconds) {
  const s = seconds % 60;
  const totalMinutes = Math.floor(seconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (n) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins === 0 ? `${hours}h ago` : `${hours}h ${remMins}m ago`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d ago` : `${days}d ${remHours}h ago`;
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0];
}

// overlapHours returns how many hours of an entry's [start, end] range fall
// within the given window. Used by rolling "last 24 hours" totals so an
// overnight sleep that crosses the window boundary contributes only the
// portion that's actually inside the window, instead of either its whole
// duration (if start ∈ window) or nothing (if start ∉ window). Ongoing
// entries with no end are treated as ending right now.
export function overlapHours(entry, windowStartMs, windowEndMs) {
  if (!entry?.start) return 0;
  const startMs = new Date(entry.start).getTime();
  const endMs = entry.end ? new Date(entry.end).getTime() : Date.now();
  const overlapStart = Math.max(startMs, windowStartMs);
  const overlapEnd = Math.min(endMs, windowEndMs);
  return Math.max(0, (overlapEnd - overlapStart) / 3600000);
}

export function formatDuration(durationStr) {
  if (!durationStr) return "—";
  const hours = parseDuration(durationStr);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

export function toFeedingTimeline(feedings, volumeUnit = "mL") {
  return feedings.map((f) => ({
    time: formatTime(f.end || f.start),
    label: `${f.amount ? f.amount + " " + volumeUnit : ""} ${f.method || f.type || ""}`.trim() || "Feeding",
    detail: timeAgo(f.end || f.start),
    amount: f.amount || 0,
    type: f.type,
    method: f.method,
    entry: f,
  }));
}

export function toDiaperTimeline(changes) {
  return changes.map((c) => ({
    time: formatTime(c.time),
    type: c.solid && c.wet ? "both" : c.solid ? "solid" : "wet",
    ago: timeAgo(c.time),
    color: c.color,
    entry: c,
  }));
}

export function toSleepBlocks(sleepEntries) {
  return sleepEntries.map((s) => ({
    start: formatTime(s.start),
    end: s.end ? formatTime(s.end) : "ongoing",
    duration: parseDuration(s.duration),
    nap: s.nap,
    entry: s,
  }));
}

export function toNoteTimeline(notes) {
  return notes.map((n) => ({
    time: formatTime(n.time),
    text: n.note,
    ago: timeAgo(n.time),
    entry: n,
  }));
}

export function toGrowthSeries(entries, valueKey) {
  return entries
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e) => ({
      timestamp: new Date(e.date).getTime(),
      date: new Date(e.date).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      }),
      [valueKey]: parseFloat(e[valueKey]),
      entry: e,
    }));
}

export function formatGrowthTick(timestamp) {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function getLast7Days() {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const result = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push({
      label: dayNames[d.getDay()],
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

function entryDateStr(dateVal) {
  const d = new Date(dateVal);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function aggregateByDayOfWeek(entries, valueKey, dateKey = "start") {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e[valueKey] || 0);
  });
  return days.map((d) => ({ day: d.label, amount: Math.round(sums[d.dateStr]) }));
}

export function aggregateSleepByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    for (const d of days) {
      const dayStartMs = new Date(`${d.dateStr}T00:00:00`).getTime();
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
      sums[d.dateStr] += overlapHours(e, dayStartMs, dayEndMs);
    }
  });
  return days.map((d) => ({ day: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
}

export function aggregateTummyByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start);
    if (key in sums) sums[key] += parseDuration(e.duration) * 60;
  });
  return days.map((d) => ({ day: d.label, minutes: Math.round(sums[d.dateStr]) }));
}

function getLastNDays(n) {
  const result = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const month = d.toLocaleDateString([], { month: "short", day: "numeric" });
    result.push({
      label: month,
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

export function dailyFeedingTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e.amount || 0);
  });
  const result = days.map((d) => ({ date: d.label, amount: Math.round(sums[d.dateStr]) }));
  const firstNonZero = result.findIndex((d) => d.amount > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

export function getEntriesForDay(entries, dayLabel, dateKey = "start") {
  const days = getLast7Days();
  const targetDay = days.find((d) => d.label === dayLabel);
  if (!targetDay) return [];

  return entries.filter((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    return key === targetDay.dateStr;
  });
}

export function getEntriesForDate(entries, dateLabel, dateKey = "start") {
  const targetDate = dateLabel; // Already in format like "Jan 15"
  return entries.filter((e) => {
    const entryDate = new Date(e[dateKey] || e.time || e.date);
    const formattedDate = entryDate.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    return formattedDate === targetDate;
  });
}

/**
 * Aggregate feeding counts per day over the last N days, grouped by feeding type.
 * Returns an array of { date, type, count } suitable for a Recharts
 * stacked-bar with multiple data keys.
 *
 * The `type` field maps directly to the feeding entry's `type` property
 * (e.g. "breast milk", "formula", "solid food").  Entries that have no
 * matching type are silently ignored.
 */
export function dailyFeedingCountsByType(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = {}));

  // Known feeding type keys that the chart will render
  const feedingTypeKeys = [
    "breast milk",
    "formula",
    "fortified breast milk",
    "solid food",
  ];

  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    const type = e.type || e.method || "other";
    // Only count types we know how to display; everything else goes into "other"
    const normalizedType = feedingTypeKeys.includes(type) ? type : "other";
    for (const d of days) {
      if (d.dateStr === key) {
        sums[d.dateStr][normalizedType] = (sums[d.dateStr][normalizedType] || 0) + 1;
      }
    }
  });

  // Convert to the flat array shape Recharts stacked-bar expects
  const result = [];
  for (const d of days) {
    const base = { date: d.label };
    for (const type of feedingTypeKeys) {
      base[type] = sums[d.dateStr][type] || 0;
    }
    // "other" bucket for any unknown types
    base.other = sums[d.dateStr]["other"] || 0;
    result.push(base);
  }

  // Trim leading zero-only days
  const firstNonZero = result.findIndex(
    (d) =>
      feedingTypeKeys.some((t) => d[t] > 0) || d.other > 0,
  );
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

export function dailySleepTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    for (const d of days) {
      const dayStartMs = new Date(`${d.dateStr}T00:00:00`).getTime();
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
      sums[d.dateStr] += overlapHours(e, dayStartMs, dayEndMs);
    }
  });
  const result = days.map((d) => ({ date: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
  const firstNonZero = result.findIndex((d) => d.hours > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}
