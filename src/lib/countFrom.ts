import { configPath, type Config, type Review, type SubscriptionSnapshot } from "@/lib/store/paths";
import type { Store } from "@/lib/store/store";

// Per-app counting cutoff: `countFrom` (YYYY-MM-DD, inclusive) in data/config.json.
//
// Why: an app transferred in from another developer (App Store Connect app transfer) is ours only
// from the day the transfer was accepted. Apple's transfer agreement gives the new owner the
// sales, analytics and performance data from that date; the previous owner's downloads, proceeds,
// reviews and ratings history must never count toward this portfolio. Apple's APIs do not respect
// that boundary on their own: the ONGOING analytics report restates a rolling ~16-day window, the
// sales collector walks a trailing day-5…day-1 window, and the reviews endpoint returns the full
// review history. A one-time cleanup would not hold, so the cutoff is enforced twice:
//   write path: orchestrator (sales, analytics, reviews, ratings, keywords), the subscription
//               stock collector and scripts/backfill-revenue.ts never persist an earlier day;
//   read path:  buildGlance (incl. lifetime months), loadRawBundle (all charts / funnels),
//               the revenue, reviews and ASO pages and the intelligence inputs ignore any
//               earlier day that is in the data repo anyway.
// Apps without countFrom pass through untouched (same array, same values).

/** appId → countFrom, for the apps that have one. */
export type CountFromMap = Record<string, string>;

export function countFromMap(config: Config): CountFromMap {
  const out: CountFromMap = {};
  for (const [id, c] of Object.entries(config.apps)) if (c.countFrom) out[id] = c.countFrom;
  return out;
}

export async function loadCountFrom(store: Pick<Store, "readJson">): Promise<CountFromMap> {
  return countFromMap(await store.readJson<Config>(configPath(), { apps: {} }));
}

/** Rows dated on or after `from`; the same array when there is no cutoff. */
export function onOrAfter<T extends { day: string }>(rows: T[], from: string | undefined): T[] {
  return from ? rows.filter((r) => r.day >= from) : rows;
}

/** Reviews created on or after `from` (by the review's own calendar date). */
export function reviewsOnOrAfter(reviews: Review[], from: string | undefined): Review[] {
  return from ? reviews.filter((r) => r.createdDate.slice(0, 10) >= from) : reviews;
}

/** First day of an app's lifetime totals: the later of firstSeen and countFrom. */
export function lifetimeFrom(firstSeen: string, from: string | undefined): string {
  return from && from > firstSeen ? from : firstSeen;
}

/** The stock snapshot without products of apps whose countFrom is after the report date. */
export function subscriptionsOnOrAfter(
  snapshot: SubscriptionSnapshot | null, cf: CountFromMap,
): SubscriptionSnapshot | null {
  if (!snapshot) return snapshot;
  const keep = snapshot.products.filter((p) => !cf[p.appAppleId] || snapshot.reportDate >= cf[p.appAppleId]);
  return keep.length === snapshot.products.length ? snapshot : { ...snapshot, products: keep };
}
