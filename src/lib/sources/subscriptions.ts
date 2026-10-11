import { gunzipSync } from "node:zlib";
import { parseTsv } from "@/lib/asc/client";
import { signAscToken, type AscKey } from "@/lib/asc/jwt";
import { addDays } from "@/lib/dates";
import { subscriptionsPath, type SubscriptionCounts, type SubscriptionProduct, type SubscriptionSnapshot } from "@/lib/store/paths";
import type { Store } from "@/lib/store/store";

// Official SUBSCRIPTION/SUMMARY 1_3 stock report. These groups are disjoint; grace/retry
// describe billing states and must never be added to paid subscription totals.
const COUNT_COLUMNS: Record<keyof SubscriptionCounts, string[]> = {
  standardPrice: ["Active Standard Price Subscriptions"],
  freeTrial: [
    "Active Free Trial Introductory Offer Subscriptions", "Free Trial Promotional Offer Subscriptions",
    "Free Trial Offer Code Subscriptions", "Free Trial Win-back Offers",
  ],
  paidOffer: [
    "Active Pay Up Front Introductory Offer Subscriptions", "Active Pay As You Go Introductory Offer Subscriptions",
    "Pay Up Front Promotional Offer Subscriptions", "Pay As You Go Promotional Offer Subscriptions",
    "Pay Up Front Offer Code Subscriptions", "Pay As You Go Offer Code Subscriptions",
    "Pay Up Front Win-back Offers", "Pay As You Go Win-back Offers",
  ],
  marketingOptIn: ["Marketing Opt-Ins"], gracePeriod: ["Grace Period"], billingRetry: ["Billing Retry"],
};
const ID_COLUMNS = ["App Name", "App Apple ID", "Subscription Name", "Subscription Apple ID", "Subscription Group ID", "Standard Subscription Duration"];
const REQUIRED_COLUMNS = [...ID_COLUMNS, ...Object.values(COUNT_COLUMNS).flat()];

function checkColumns(columns: string[]): void {
  const available = new Set(columns.map((s) => s.trim().toLowerCase()));
  if (REQUIRED_COLUMNS.some((s) => !available.has(s.toLowerCase()))) {
    throw new Error("Subscription report is missing required 1_3 columns");
  }
}

export function parseSubscriptionSnapshot(
  rows: Record<string, string>[], reportDate: string, collectedAt = new Date().toISOString(),
): SubscriptionSnapshot {
  const products = new Map<string, SubscriptionProduct>();
  for (const raw of rows) {
    checkColumns(Object.keys(raw));
    // Apple documentation and actual TSV differ in capitalization of 'as' / 'Win-back'.
    const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v.trim()]));
    const get = (name: string) => row[name.toLowerCase()];
    if (!get("App Apple ID") || !get("Subscription Apple ID")) throw new Error("Subscription report is missing a product identifier");
    const counts = {} as SubscriptionCounts;
    for (const key of Object.keys(COUNT_COLUMNS) as (keyof SubscriptionCounts)[]) {
      counts[key] = COUNT_COLUMNS[key].reduce((total, column) => {
        const value = get(column);
        if (!/^\d+$/.test(value)) throw new Error("Subscription report contains an invalid count");
        const n = Number(value);
        if (!Number.isSafeInteger(n)) throw new Error("Subscription count exceeds the supported range");
        return total + n;
      }, 0);
    }
    const id = `${get("App Apple ID")}|${get("Subscription Apple ID")}`;
    const previous = products.get(id);
    if (previous) {
      if (previous.duration !== get("Standard Subscription Duration")) throw new Error("Subscription duration differs within one product");
      for (const key of Object.keys(counts) as (keyof SubscriptionCounts)[]) previous.counts[key] += counts[key];
    } else {
      products.set(id, {
        appName: get("App Name"), appAppleId: get("App Apple ID"), subscriptionName: get("Subscription Name"),
        subscriptionAppleId: get("Subscription Apple ID"), subscriptionGroupId: get("Subscription Group ID"),
        duration: get("Standard Subscription Duration"), counts,
      });
    }
  }
  return {
    reportDate, collectedAt, source: "SUBSCRIPTION/SUMMARY 1_3",
    products: [...products.values()].sort((a, b) => a.appAppleId.localeCompare(b.appAppleId) || a.subscriptionAppleId.localeCompare(b.subscriptionAppleId)),
  };
}

// null means not published; an empty array means a valid header-only report (zero stock).
export type FetchSubscriptionsTsv = (day: string) => Promise<Record<string, string>[] | null>;

export const ascFetchSubscriptionsTsv = (key: AscKey, vendor: string): FetchSubscriptionsTsv => async (day) => {
  const query = new URLSearchParams({
    "filter[frequency]": "DAILY", "filter[reportType]": "SUBSCRIPTION", "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": vendor, "filter[reportDate]": day, "filter[version]": "1_3",
  });
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${query}`, {
    headers: { Authorization: `Bearer ${signAscToken(key)}`, Accept: "application/a-gzip" },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Subscription report request failed (HTTP ${res.status})`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  checkColumns(text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0].split("\t"));
  return parseTsv(text.replace(/^\uFEFF/, ""));
};

export interface SubscriptionsResult { ok: boolean; reportDate?: string; products?: number; error?: string }

export function newerSubscriptionSnapshot(previous: SubscriptionSnapshot | null, incoming: SubscriptionSnapshot): SubscriptionSnapshot {
  if (!previous) return incoming;
  if (previous.reportDate > incoming.reportDate) return previous;
  if (previous.reportDate === incoming.reportDate && previous.collectedAt > incoming.collectedAt) return previous;
  return incoming;
}

export async function collectSubscriptionsInto(
  fetchTsv: FetchSubscriptionsTsv, store: Store, day: string, collectedAt = new Date().toISOString(),
): Promise<SubscriptionsResult> {
  try {
    // Five bounded account-wide requests run together, not once per app or per UI render.
    const dates = Array.from({ length: 5 }, (_, i) => addDays(day, -i - 1));
    const reports = await Promise.allSettled(dates.map((d) => fetchTsv(d)));
    const newest = reports.findIndex((r) => r.status === "fulfilled" && r.value !== null);
    if (newest === -1) return { ok: false, error: "No subscription report available in the last five days; the previous snapshot is retained." };
    const report = reports[newest] as PromiseFulfilledResult<Record<string, string>[]>;
    const snapshot = parseSubscriptionSnapshot(report.value, dates[newest], collectedAt);
    await store.writeJson(subscriptionsPath(), snapshot, `data: subscription stock ${snapshot.reportDate}`, newerSubscriptionSnapshot);
    return { ok: true, reportDate: snapshot.reportDate, products: snapshot.products.length };
  } catch {
    // Never overwrite the last valid stock with zeros after an API/schema/storage failure.
    return { ok: false, error: "Subscription report refresh failed; the previous snapshot is retained." };
  }
}
