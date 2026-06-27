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

// EUR-converted proceeds (lib/fx) when present, else the legacy raw mixed-currency lump for rows
// collected before the FX fix / backfill. Single accessor so every proceeds read is consistent.
const proceedsOf = (s: SalesDay) => s.proceedsEur ?? s.proceedsUsd ?? 0;

export function buildRevenue(admob: AdMobRow[], sales: SalesDay[]): RevenueSummary {
  const ad = new Map<string, number>();
  for (const r of admob) ad.set(r.day, (ad.get(r.day) ?? 0) + r.earnings);
  const iap = new Map<string, number>();
  for (const s of sales) iap.set(s.day, (iap.get(s.day) ?? 0) + proceedsOf(s));

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

// Per-app / per-day breakdown of App Store in-app-purchase & subscription proceeds. The unified
// summary above only carries one IAP number; this gives the Revenue tab the same "by app" and
// "by day" view it already has for AdMob. (Apple's daily sales report carries proceeds, not a
// separate transaction count, so this is a revenue breakdown, not a purchase count.)
export interface IapBreakdown {
  totalProceeds: number;
  byApp: { appId: string; name: string; proceeds: number }[]; // desc, apps with >0 only
  byDay: { day: string; proceeds: number }[];                 // ascending by day
  appsWithRevenue: number;
}

export function buildIapBreakdown(
  apps: { appId: string; name: string; sales: SalesDay[] }[],
): IapBreakdown {
  const byApp: IapBreakdown["byApp"] = [];
  const dayMap = new Map<string, number>();
  for (const { appId, name, sales } of apps) {
    let appProceeds = 0;
    for (const s of sales) {
      const p = proceedsOf(s);
      if (!p) continue;
      appProceeds += p;
      dayMap.set(s.day, (dayMap.get(s.day) ?? 0) + p);
    }
    if (appProceeds > 0) byApp.push({ appId, name, proceeds: round2(appProceeds) });
  }
  byApp.sort((a, b) => b.proceeds - a.proceeds);
  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, p]) => ({ day, proceeds: round2(p) }));
  const totalProceeds = round2(byApp.reduce((s, a) => s + a.proceeds, 0));
  return { totalProceeds, byApp, byDay, appsWithRevenue: byApp.length };
}
