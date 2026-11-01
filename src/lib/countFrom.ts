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
//
// Dates are compared as strings, so a value must be a real zero-padded calendar date: "2026-11-1"
// sorts after "2026-11-09" and would silently let the first nine days through. An invalid value
// stops collection (countFromMap throws before anything is written); read paths log it and count
// nothing for that app (COUNT_NOTHING) rather than show the previous owner's history.

/** appId → countFrom, for the apps that have one. */
export type CountFromMap = Record<string, string>;

/** Read-path stand-in for an invalid countFrom: later than any real day, so nothing counts. */
export const COUNT_NOTHING = "9999-12-31";

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Collection / write paths: throws on an invalid countFrom. */
export function countFromMap(config: Config, onInvalid: "throw" | "countNothing" = "throw"): CountFromMap {
  const out: CountFromMap = {};
  for (const [id, c] of Object.entries(config.apps)) {
    if (c.countFrom === undefined) continue;
    if (isCalendarDay(c.countFrom)) { out[id] = c.countFrom; continue; }
    const problem = `data/config.json apps.${id}.countFrom ${JSON.stringify(c.countFrom)} is not a valid YYYY-MM-DD date`;
    if (onInvalid === "throw") throw new Error(problem);
    console.error(`${problem}; counting nothing for this app until it is fixed`);
    out[id] = COUNT_NOTHING;
  }
  return out;
}

/** Read paths: an invalid countFrom is logged and counts nothing for that app. */
export async function loadCountFrom(store: Pick<Store, "readJson">): Promise<CountFromMap> {
  return countFromMap(await store.readJson<Config>(configPath(), { apps: {} }), "countNothing");
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
