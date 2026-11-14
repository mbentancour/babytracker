import { useEffect } from "react";
import { useActiveTooltipDataPoints } from "recharts";

// Mirrors the point Recharts' tooltip currently shows into store.current[type].
export default function ActiveChartPoint({ store, type }) {
  const point = useActiveTooltipDataPoints()?.[0] ?? null;
  useEffect(() => {
    store.current[type] = point;
  }, [store, type, point]);
  return null;
}
