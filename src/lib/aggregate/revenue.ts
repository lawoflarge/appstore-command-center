import type { AdMobRow } from "@/lib/sources/admob";
import type { SalesDay } from "@/lib/store/paths";

// Unified revenue = AdMob ad earnings + App Store developer proceeds (IAP / subscriptions).
// For the free apps tracked here, every ASC proceed is an in-app purchase or subscription,
// so SalesDay.proceedsUsd stands in for "in-app & subscription revenue". Amounts are summed
// at their reported value (no FX normalization) — honest caveat surfaced in the UI.

export interface RevenuePoint { day: string; ad: number; iap: number; total: number }

export interface RevenueSummary {
  adEarnings: number;
  iapProceeds: number;
  total: number;
  adShare: number; // 0..1 share of total from ads
  iapShare: number;
  byDay: RevenuePoint[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildRevenue(admob: AdMobRow[], sales: SalesDay[]): RevenueSummary {
  const ad = new Map<string, number>();
  for (const r of admob) ad.set(r.day, (ad.get(r.day) ?? 0) + r.earnings);
  const iap = new Map<string, number>();
  for (const s of sales) iap.set(s.day, (iap.get(s.day) ?? 0) + s.proceedsUsd);

  const days = [...new Set([...ad.keys(), ...iap.keys()])].sort((a, b) => a.localeCompare(b));
  const byDay: RevenuePoint[] = days.map((day) => {
    const a = round2(ad.get(day) ?? 0);
    const i = round2(iap.get(day) ?? 0);
    return { day, ad: a, iap: i, total: round2(a + i) };
  });

  const adEarnings = round2(byDay.reduce((s, p) => s + p.ad, 0));
  const iapProceeds = round2(byDay.reduce((s, p) => s + p.iap, 0));
  const total = round2(adEarnings + iapProceeds);
  return {
    adEarnings, iapProceeds, total,
    adShare: total > 0 ? adEarnings / total : 0,
    iapShare: total > 0 ? iapProceeds / total : 0,
    byDay,
  };
}
