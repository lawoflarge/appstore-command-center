import type { Insights, AppInsight } from "./engine";

export type Severity = "critical" | "opportunity" | "good";
export type ActionKind =
  | "anomaly_drop"
  | "anomaly_spike"
  | "funnel_pvd"
  | "funnel_ipv"
  | "keyword_declining"
  | "keyword_opportunity";

export interface ActionItem {
  appId: string;
  appName: string;
  kind: ActionKind;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  score: number;
}

// Max keyword items emitted per app so one noisy app cannot flood the feed.
const KEYWORD_CAP = 3;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function dropPct(rate: number, baseline: number): number {
  return baseline > 0 ? Math.max(0, (baseline - rate) / baseline) : 0;
}

function appItems(appId: string, a: AppInsight): ActionItem[] {
  const items: ActionItem[] = [];

  // --- Anomalies ---
  if (a.anomaly) {
    const z = Math.abs(a.anomaly.z);
    if (a.anomaly.direction === "drop") {
      const nearRelease = a.anomaly.cause.startsWith("Near the");
      items.push({
        appId, appName: a.name, kind: "anomaly_drop", severity: "critical",
        title: "Downloads dropped sharply",
        detail: `${a.anomaly.value.toLocaleString()} vs a baseline of ${Math.round(a.anomaly.baseline).toLocaleString()}. ${a.anomaly.cause}.`,
        recommendation: nearRelease
          ? "Downloads fell right after a recent release. Diff that release — a regression or store-listing change is the likely cause."
          : "No release nearby. Check App Store availability and look for an external cause (seasonality, a lost feature or ASA campaign).",
        score: 1000 + z * 10,
      });
    } else {
      items.push({
        appId, appName: a.name, kind: "anomaly_spike", severity: "good",
        title: "Downloads spiked",
        detail: `${a.anomaly.value.toLocaleString()} vs a baseline of ${Math.round(a.anomaly.baseline).toLocaleString()}. ${a.anomaly.cause}.`,
        recommendation: "Find what drove it (press, a feature, an ASA campaign) and double down while it lasts.",
        score: 100 + z,
      });
    }
  }

  // --- Funnel leaks ---
  if (a.funnel.leak === "pageView_to_install") {
    const d = dropPct(a.funnel.rates.pvd, a.funnel.rates.baselinePvd);
    items.push({
      appId, appName: a.name, kind: "funnel_pvd", severity: "critical",
      title: "Page views aren't converting to installs",
      detail: `Page-view to install fell to ${pct(a.funnel.rates.pvd)} (was ${pct(a.funnel.rates.baselinePvd)}).`,
      recommendation: "People view the page but don't install. Refresh screenshots/icon or address a low rating.",
      score: 1000 + d * 100,
    });
  } else if (a.funnel.leak === "impression_to_pageView") {
    const d = dropPct(a.funnel.rates.ipv, a.funnel.rates.baselineIpv);
    items.push({
      appId, appName: a.name, kind: "funnel_ipv", severity: "critical",
      title: "Impressions aren't earning page views",
      detail: `Impression to page-view fell to ${pct(a.funnel.rates.ipv)} (was ${pct(a.funnel.rates.baselineIpv)}).`,
      recommendation: "People see you in search/browse but don't tap through. Your icon, title or first screenshot isn't earning the tap.",
      score: 1000 + d * 100 - 1, // ranks just below an equal-magnitude pvd leak
    });
  }

  // --- Keyword moves (cap per app) ---
  const kw = a.opportunities
    .filter((o) => o.trend === "declining" || o.trend === "improving")
    .map<ActionItem>((o) => {
      const declining = o.trend === "declining";
      return {
        appId, appName: a.name,
        kind: declining ? "keyword_declining" : "keyword_opportunity",
        severity: "opportunity",
        title: declining ? `Keyword "${o.term}" is slipping` : `Keyword "${o.term}" is climbing`,
        detail: declining
          ? `${o.term} (${o.country}) is now #${o.rank}.`
          : `${o.term} (${o.country}) is #${o.rank} and climbing.`,
        recommendation: declining
          ? "Refresh your keyword field / metadata to defend the ranking."
          : "Work it into your title/subtitle to push it into the top 10.",
        score: (declining ? 500 : 400) + (26 - o.rank),
      };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, KEYWORD_CAP);
  items.push(...kw);

  return items;
}

export function buildActionItems(insights: Insights): ActionItem[] {
  const out: ActionItem[] = [];
  for (const [appId, a] of Object.entries(insights.apps)) {
    out.push(...appItems(appId, a));
  }
  return out.sort((x, y) => y.score - x.score);
}
