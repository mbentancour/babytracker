// splitDaily adds to every day of a daily series what each named part
// contributed to it, so a chart can stack the parts: `parts` is
// { name: series } and the figure is read from each part's own row for that
// day by `valueKey` (0 on a day the part has no row for). A day of sleep
// { date, hours } becomes { date, hours, night, nap }.
//
// The parts are matched by date because each series is trimmed of its own
// leading empty days (see dailySleepTotals and friends in formatters.js), so
// they do not all start on the same day.
export function splitDaily(total, parts, valueKey) {
  const lookups = Object.entries(parts).map(([name, series]) => [name, new Map(series.map((day) => [day.date, day[valueKey]]))]);
  return total.map((day) => ({
    ...day,
    ...Object.fromEntries(lookups.map(([name, byDate]) => [name, byDate.get(day.date) ?? 0])),
  }));
}
