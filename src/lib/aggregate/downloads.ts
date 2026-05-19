import type { SalesDay } from "@/lib/store/paths";
import type { Point } from "@/lib/intelligence/baseline";

export function downloadsSeries(sales: SalesDay[]): Point[] {
  return [...sales].sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => ({ day: s.day, value: s.total }));
}

export function totals(sales: SalesDay[], day: string) {
  const sorted = [...sales].sort((a, b) => a.day.localeCompare(b.day));
  const total = sorted.reduce((s, d) => s + d.total, 0);
  const idx = sorted.findIndex((s) => s.day === day);
  const today = idx >= 0 ? sorted[idx].total : 0;
  const prev = idx > 0 ? sorted[idx - 1].total : 0;
  const deltaPct = prev > 0 ? Math.round(((today - prev) / prev) * 100) : 0;
  return { total, today, prev, deltaPct };
}
