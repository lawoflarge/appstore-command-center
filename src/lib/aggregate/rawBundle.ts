import type { Store } from "@/lib/store/store";
import {
  salesPath, analyticsPath, ratingsPath, reviewsPath, keywordsPath, appMetaPath,
  type SalesDay, type AnalyticsDay, type RatingPoint, type Review, type KeywordRank, type AppMeta,
} from "@/lib/store/paths";
import type { RawBundle } from "./series";

function lastNMonths(today: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(today + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7) + "-01");
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export async function loadRawBundle(
  store: Store, appIds: string[], today: string, months: number,
): Promise<RawBundle> {
  const monthStarts = lastNMonths(today, months);
  const apps: RawBundle["apps"] = {};
  const sales: RawBundle["sales"] = {};
  const analytics: RawBundle["analytics"] = {};
  const ratings: RawBundle["ratings"] = {};
  const reviews: RawBundle["reviews"] = {};
  const keywords: RawBundle["keywords"] = {};

  await Promise.all(appIds.map(async (id) => {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    apps[id] = { name: meta?.name ?? id };
    const [s, a, r, k] = await Promise.all([
      Promise.all(monthStarts.map((m) => store.readJson<SalesDay[]>(salesPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<AnalyticsDay[]>(analyticsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<RatingPoint[]>(ratingsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<KeywordRank[]>(keywordsPath(id, m), []))),
    ]);
    sales[id]     = s.flat();
    analytics[id] = a.flat();
    ratings[id]   = r.flat();
    keywords[id]  = k.flat();
    reviews[id]   = await store.readJson<Review[]>(reviewsPath(id), []);
  }));

  return { apps, sales, analytics, ratings, reviews, keywords, today };
}
