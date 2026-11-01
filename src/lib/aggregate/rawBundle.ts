import type { Store } from "@/lib/store/store";
import {
  salesPath, analyticsPath, ratingsPath, reviewsPath, keywordsPath, appMetaPath,
  type SalesDay, type AnalyticsDay, type RatingPoint, type Review, type KeywordRank, type AppMeta,
} from "@/lib/store/paths";
import { rowsInMonth } from "@/lib/dates";
import { loadCountFrom, onOrAfter, reviewsOnOrAfter } from "@/lib/countFrom";
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
  const cf = await loadCountFrom(store);

  await Promise.all(appIds.map(async (id) => {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    apps[id] = { name: meta?.name ?? id };
    const [s, a, r, k] = await Promise.all([
      Promise.all(monthStarts.map((m) => store.readJson<SalesDay[]>(salesPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<AnalyticsDay[]>(analyticsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<RatingPoint[]>(ratingsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<KeywordRank[]>(keywordsPath(id, m), []))),
    ]);
    // Filter each month file to its own month before flattening — Apple's rolling analytics window
    // can spill a prior month's days into the current file, which would double-count in funnel /
    // breakdown reads (they sum every row) and resolve to stale values in the day-keyed maps.
    // Then drop anything before the app's countFrom (app transfer, see lib/countFrom.ts): every
    // chart, funnel and breakdown on Glance and the per-app page reads through here.
    const from = cf[id];
    sales[id]     = onOrAfter(s.flatMap((rows, i) => rowsInMonth(rows, monthStarts[i])), from);
    analytics[id] = onOrAfter(a.flatMap((rows, i) => rowsInMonth(rows, monthStarts[i])), from);
    ratings[id]   = onOrAfter(r.flatMap((rows, i) => rowsInMonth(rows, monthStarts[i])), from);
    keywords[id]  = onOrAfter(k.flatMap((rows, i) => rowsInMonth(rows, monthStarts[i])), from);
    reviews[id]   = reviewsOnOrAfter(await store.readJson<Review[]>(reviewsPath(id), []), from);
  }));

  return { apps, sales, analytics, ratings, reviews, keywords, today };
}
