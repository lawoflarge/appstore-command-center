export interface FunnelStage { impressions: number; pageViews: number; downloads: number; }
export interface FunnelDiagnosis {
  leak: "impression_to_pageView" | "pageView_to_install" | "none";
  message: string;
  rates: { ipv: number; pvd: number; baselineIpv: number; baselinePvd: number };
}

const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

export function diagnoseFunnel(today: FunnelStage, baseline: FunnelStage): FunnelDiagnosis {
  const ipv = rate(today.pageViews, today.impressions);
  const pvd = rate(today.downloads, today.pageViews);
  const bIpv = rate(baseline.pageViews, baseline.impressions);
  const bPvd = rate(baseline.downloads, baseline.pageViews);
  const rates = { ipv, pvd, baselineIpv: bIpv, baselinePvd: bPvd };
  const dropIpv = bIpv > 0 ? (bIpv - ipv) / bIpv : 0;
  const dropPvd = bPvd > 0 ? (bPvd - pvd) / bPvd : 0;
  if (dropPvd >= 0.25 && dropPvd >= dropIpv)
    return { leak: "pageView_to_install", rates,
      message: `Page-view→install conversion fell to ${(pvd * 100).toFixed(1)}% (was ${(bPvd * 100).toFixed(1)}%). Screenshots/icon/rating likely.` };
  if (dropIpv >= 0.25)
    return { leak: "impression_to_pageView", rates,
      message: `Impression→page-view fell to ${(ipv * 100).toFixed(1)}% (was ${(bIpv * 100).toFixed(1)}%). Icon/title/first screenshot likely.` };
  return { leak: "none", rates, message: "Funnel within normal range." };
}
