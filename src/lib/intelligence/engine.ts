import { detectAnomalies, type Anomaly } from "./anomaly";
import { diagnoseFunnel, type FunnelStage, type FunnelDiagnosis } from "./funnel";
import { keywordOpportunities, type Opportunity } from "./keywords";
import { forecastMonth, type Forecast } from "./forecast";
import { clusterReviews, type ClusterResult } from "./sentiment";
import { buildDigest, isDigestDay } from "./digest";
import type { Point } from "./baseline";
import type { KeywordRank, Review } from "@/lib/store/paths";

export interface AppInput {
  appId: string; name: string;
  downloads: Point[];
  funnelToday: FunnelStage; funnelBaseline: FunnelStage;
  keywords: KeywordRank[];
  releases: { version: string; date: string }[];
  newReviews: Review[];
}
export interface AppInsight {
  name: string;
  anomaly: Anomaly | null;
  funnel: FunnelDiagnosis;
  opportunities: Opportunity[];
  forecast: Forecast;
  reviewThemes: ClusterResult;
}
export interface Insights {
  generatedAt: string;
  apps: Record<string, AppInsight>;
  digest?: string;
}

export async function runIntelligence(input: {
  day: string;
  apps: AppInput[];
  llm: { complete: (s: string, u: string) => Promise<string> };
}): Promise<Insights> {
  const apps: Record<string, AppInsight> = {};
  for (const a of input.apps) {
    apps[a.appId] = {
      name: a.name,
      anomaly: detectAnomalies({ appId: a.appId, metric: "downloads", series: a.downloads, day: input.day, releases: a.releases }),
      funnel: diagnoseFunnel(a.funnelToday, a.funnelBaseline),
      opportunities: keywordOpportunities(a.keywords, input.day),
      forecast: forecastMonth(a.downloads, input.day),
      reviewThemes: await clusterReviews(input.llm, a.newReviews),
    };
  }
  const out: Insights = { generatedAt: input.day, apps };
  if (isDigestDay(input.day)) {
    out.digest = await buildDigest(input.llm, {
      day: input.day,
      apps: Object.entries(apps).map(([id, v]) => ({
        id, name: v.name, anomaly: v.anomaly, funnel: v.funnel.leak,
        opportunities: v.opportunities.slice(0, 5), forecast: v.forecast,
      })),
    });
  }
  return out;
}
