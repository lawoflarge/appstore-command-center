import type { Store } from "@/lib/store/store";
import { salesPath, appMetaPath, insightsPath, ratingsPath, configPath, runStatusPath, type SalesDay, type AppMeta, type RatingPoint, type Config, type RunStatus } from "@/lib/store/paths";
import { totals } from "./downloads";

export async function buildGlance(store: Store, appIds: string[], month: string) {
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  const apps = [];
  let ratingWeighted = 0;
  let ratingCount = 0;
  for (const id of appIds) {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    if (!meta || meta.hidden || meta.archived) continue;
    const sales = await store.readJson<SalesDay[]>(salesPath(id, month + "-01"), []);
    const day = sales.at(-1)?.day ?? "";
    const ratings = await store.readJson<RatingPoint[]>(ratingsPath(id, month + "-01"), []);
    const lastRating = ratings.at(-1) ?? null;
    if (lastRating && lastRating.count > 0) {
      ratingWeighted += lastRating.avg * lastRating.count;
      ratingCount += lastRating.count;
    }
    apps.push({
      appId: id,
      name: meta.name,
      ...totals(sales, day),
      rating: lastRating ? { avg: lastRating.avg, count: lastRating.count } : null,
      anomaly: insights.apps?.[id]?.anomaly ?? null,
    });
  }
  return { apps, blendedRating: { avg: ratingCount ? ratingWeighted / ratingCount : 0, count: ratingCount } };
}

/**
 * Default visibility = "all discovered, none hidden". Discovered apps come from
 * run-status (every cron writes it). Config is an overlay for hide/archive/keywords;
 * an empty config no longer means "no apps", which was the source of the spurious
 * "No data yet" state on first deploy.
 */
export async function visibleAppIds(store: Store): Promise<string[]> {
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  const status = await store.readJson<RunStatus | null>(runStatusPath(), null);
  const discovered = status ? Object.keys(status.perApp) : [];
  return discovered.filter((id) => {
    const c = cfg.apps[id];
    return !c || (!c.hidden && !c.archived);
  });
}
