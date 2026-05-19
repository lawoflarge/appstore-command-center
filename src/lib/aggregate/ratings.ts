import type { RatingPoint } from "@/lib/store/paths";

export function ratingTrend(points: RatingPoint[]) {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted.at(-1);
  const prev = sorted.at(-2);
  return {
    current: last?.avg ?? 0,
    count: last?.count ?? 0,
    delta: last && prev ? Number((last.avg - prev.avg).toFixed(2)) : 0,
    series: sorted.map((p) => ({ day: p.day, value: p.avg })),
  };
}
