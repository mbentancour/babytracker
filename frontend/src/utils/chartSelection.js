// Resolve a selection from the point the Recharts tooltip currently shows.
// Prefer the original timestamp when present: formatted date labels are
// presentation strings and must not be parsed back into dates later.
export function getPointSelection(point, seriesData, dataKey) {
  if (!point || !seriesData?.length) return null;
  const match = seriesData.includes(point)
    ? point
    : seriesData.find((p) => (p.timestamp ?? p.date) === (point.timestamp ?? point.date));
  if (!match) return null;
  return {
    label: match.timestamp ?? match.date,
    value: match[dataKey],
    entry: match.entry,
  };
}
