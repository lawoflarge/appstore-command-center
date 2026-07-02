import type { AdMobRow } from "@/lib/sources/admob";
import type { SalesDay, KickbacksDay } from "@/lib/store/paths";

// Unified revenue = AdMob ad earnings + App Store developer proceeds (IAP / subscriptions) +
// Kickbacks.ai earnings (AI wait-time sponsored status-line ads). AdMob earnings are already in
// EUR; App Store proceeds prefer the ECB-converted proceedsEur; Kickbacks earnings are stored in
// EUR (earningsEur) by the collector. Estimated / pre-finalization — honest caveat in the UI.

export interface RevenuePoint { day: string; ad: number; iap: number; kb: number; total: number }

export interface RevenueSummary {
  adEarnings: number;
  iapProceeds: number;
  kbEarnings: number;
  total: number;
  adShare: number; // 0..1 share of total from ads
  iapShare: number;
  kbShare: number;
  byDay: RevenuePoint[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// EUR-converted proceeds (lib/fx) when present, else the legacy raw mixed-currency lump for rows
// collected before the FX fix / backfill. Single accessor so every proceeds read is consistent.
const proceedsOf = (s: SalesDay) => s.proceedsEur ?? s.proceedsUsd ?? 0;

export function buildRevenue(
  admob: AdMobRow[],
  sales: SalesDay[],
  kickbacks: KickbacksDay[] = [],
): RevenueSummary {
  const ad = new Map<string, number>();
  for (const r of admob) ad.set(r.day, (ad.get(r.day) ?? 0) + r.earnings);
  const iap = new Map<string, number>();
  for (const s of sales) iap.set(s.day, (iap.get(s.day) ?? 0) + proceedsOf(s));
  const kb = new Map<string, number>();
  for (const k of kickbacks) kb.set(k.day, (kb.get(k.day) ?? 0) + (k.earningsEur ?? 0));

  const days = [...new Set([...ad.keys(), ...iap.keys(), ...kb.keys()])].sort((a, b) => a.localeCompare(b));
  const byDay: RevenuePoint[] = days.map((day) => {
    const a = round2(ad.get(day) ?? 0);
    const i = round2(iap.get(day) ?? 0);
    const k = round2(kb.get(day) ?? 0);
    return { day, ad: a, iap: i, kb: k, total: round2(a + i + k) };
  });

  const adEarnings = round2(byDay.reduce((s, p) => s + p.ad, 0));
  const iapProceeds = round2(byDay.reduce((s, p) => s + p.iap, 0));
  const kbEarnings = round2(byDay.reduce((s, p) => s + p.kb, 0));
  const total = round2(adEarnings + iapProceeds + kbEarnings);
  return {
    adEarnings, iapProceeds, kbEarnings, total,
    adShare: total > 0 ? adEarnings / total : 0,
    iapShare: total > 0 ? iapProceeds / total : 0,
    kbShare: total > 0 ? kbEarnings / total : 0,
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
