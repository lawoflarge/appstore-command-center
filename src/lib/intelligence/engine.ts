import { detectAnomalies, type Anomaly } from "./anomaly";
import { diagnoseFunnel, type FunnelStage, type FunnelDiagnosis } from "./funnel";
import { keywordOpportunities, type Opportunity } from "./keywords";
import { forecastMonth, type Forecast } from "./forecast";
import type { Point } from "./baseline";
import type { KeywordRank } from "@/lib/store/paths";

export interface AppInput {
  appId: string; name: string;
  downloads: Point[];
  funnelToday: FunnelStage; funnelBaseline: FunnelStage;
  keywords: KeywordRank[];
  releases: { version: string; date: string }[];
}
export interface AppInsight {
  name: string;
  anomaly: Anomaly | null;
  funnel: FunnelDiagnosis;
  opportunities: Opportunity[];
  forecast: Forecast;
}
export interface Insights {
  generatedAt: string;
  apps: Record<string, AppInsight>;
}

export async function runIntelligence(input: {
  day: string;
  apps: AppInput[];
}): Promise<Insights> {
  const apps: Record<string, AppInsight> = {};
  for (const a of input.apps) {
    apps[a.appId] = {
      name: a.name,
      anomaly: detectAnomalies({ appId: a.appId, metric: "downloads", series: a.downloads, day: input.day, releases: a.releases }),
      funnel: diagnoseFunnel(a.funnelToday, a.funnelBaseline),
      opportunities: keywordOpportunities(a.keywords, input.day),
      forecast: forecastMonth(a.downloads, input.day),
    };
  }
  return { generatedAt: input.day, apps };
}
