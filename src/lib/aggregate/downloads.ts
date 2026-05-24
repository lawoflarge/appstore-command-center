import type { SalesDay, AnalyticsDay } from "@/lib/store/paths";
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

// AnalyticsDay.downloads matches ASC "Analytics → Overview". Sales TSV is the
// finance report; for free apps it's commonly empty and always lags ~24h, so
// callers should prefer analytics whenever it has rows.
export function analyticsDownloadsSeries(rows: AnalyticsDay[]): Point[] {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({ day: r.day, value: r.downloads }));
}

export function analyticsTotals(rows: AnalyticsDay[], day: string) {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const total = sorted.reduce((s, d) => s + d.downloads, 0);
  const idx = sorted.findIndex((r) => r.day === day);
  const today = idx >= 0 ? sorted[idx].downloads : 0;
  const prev = idx > 0 ? sorted[idx - 1].downloads : 0;
  const deltaPct = prev > 0 ? Math.round(((today - prev) / prev) * 100) : 0;
  return { total, today, prev, deltaPct };
}
