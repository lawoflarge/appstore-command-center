import type { SalesDay, SalesProceedsType } from "@/lib/store/paths";
import { addDays } from "@/lib/dates";
import { toEur, type EurRates } from "@/lib/fx";

export type FetchSalesTsv = (day: string) => Promise<Record<string, string>[]>;
export interface SalesAppRef { appId: string; sku: string }
const DOWNLOAD = new Set(["1", "1F", "1T", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["1R", "1FR"]);

export async function collectSales(
  fetchTsv: FetchSalesTsv, apps: SalesAppRef[], day: string,
): Promise<Record<string, SalesDay>> {
  const rows = await fetchTsv(day);
  return parseSalesRows(rows, apps, day);
}

export function parseSalesRows(
  rows: Record<string, string>[], apps: SalesAppRef[], day: string,
  collectedAt = new Date().toISOString(),
): Record<string, SalesDay> {
  // An unavailable report is not proof of zero sales. Do not advance coverage for it.
  if (!rows.length) return {};
  for (const r of rows) {
    if (!["Apple Identifier", "Units", "Developer Proceeds", "Product Type Identifier"].every((k) => k in r)) {
      throw new Error("Sales report is missing required columns");
    }
    if (!/^-?\d+$/.test(r["Units"].trim()) || !Number.isSafeInteger(Number(r["Units"])) ||
      !r["Developer Proceeds"].trim() || !Number.isFinite(Number(r["Developer Proceeds"]))) {
      throw new Error("Sales report contains invalid amounts");
    }
  }
  const want = new Set(apps.map((a) => a.appId));
  // IAP / subscription proceeds are reported under the product's OWN Apple Identifier, not the
  // app's, and link back to the app via Parent Identifier = the app's SKU. Map SKU→appId so those
  // proceeds get attributed to the parent app instead of being silently dropped (which left
  // "In-app & subs" at 0 even after real sales). Seed from the discovered apps (authoritative)
  // and supplement from the report's own app-level rows.
  const skuToApp = new Map<string, string>();
  for (const a of apps) if (a.sku) skuToApp.set(a.sku, a.appId);
  for (const r of rows) {
    const sku = (r["SKU"] || "").trim();
    if (want.has(r["Apple Identifier"]) && sku && !skuToApp.has(sku)) skuToApp.set(sku, r["Apple Identifier"]);
  }

  const acc: Record<string, SalesDay> = {};
  const ensure = (appId: string) =>
    (acc[appId] ??= {
      day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: 0, proceedsByCcy: {},
      proceedsByType: { oneTime: {}, subscription: {}, other: {} }, otherProductTypes: [],
      reportAvailable: true, collectedAt,
    });
  apps.forEach((app) => ensure(app.appId));
  // Apple reports "Developer Proceeds" in each sale's own "Currency of Proceeds" (EUR/GBP/BRL/…).
  // Keep the raw lump in proceedsUsd (legacy) but ALSO bucket it by currency so lib/fx can convert
  // to one EUR figure — summing the raw numbers across currencies overstated revenue (an 18.49 BRL
  // sale was counted as 18.49 €). Skip empties so a free app's SalesDay keeps an empty {}.
  const addProceeds = (s: SalesDay, amount: number, ccy: string, productType: string) => {
    if (!amount) return;
    s.proceedsUsd += amount;
    const type: SalesProceedsType = productType === "IA1" ? "oneTime" : productType === "IAY" ? "subscription" : "other";
    if (type === "other" && !s.otherProductTypes!.includes(productType || "UNKNOWN")) {
      s.otherProductTypes!.push(productType || "UNKNOWN");
    }
    if (!ccy) { s.proceedsCurrencyMissing = true; return; }
    s.proceedsByCcy![ccy] = (s.proceedsByCcy![ccy] ?? 0) + amount;
    const bucket = s.proceedsByType![type];
    bucket[ccy] = (bucket[ccy] ?? 0) + amount;
  };

  for (const r of rows) {
    const appId = r["Apple Identifier"];
    const units = parseInt(r["Units"] || "0", 10);
    const proceeds = parseFloat(r["Developer Proceeds"] || "0") || 0;
    const ccy = (r["Currency of Proceeds"] || "").trim();
    const ptype = (r["Product Type Identifier"] || "").trim();
    if (want.has(appId)) {
      const s = ensure(appId);
      if (DOWNLOAD.has(ptype)) {
        s.byCountry[r["Country Code"]] = (s.byCountry[r["Country Code"]] ?? 0) + units;
        s.total += units;
      } else if (REDOWNLOAD.has(ptype)) {
        s.redownloads += units;
      }
      addProceeds(s, proceeds * units, ccy, ptype);
    } else if (proceeds) {
      // An IAP / subscription row — credit its proceeds to the parent app it belongs to.
      const parent = skuToApp.get((r["Parent Identifier"] || "").trim());
      if (parent) addProceeds(ensure(parent), proceeds * units, ccy, ptype);
    }
  }
  return acc;
}

// Use the same daily FX rates for total and categories. Assign the possible rounding cent to
// the largest category so the displayed split exactly reconciles to the existing total.
export function convertSalesDayToEur(s: SalesDay, rates: EurRates): void {
  if (s.proceedsCurrencyMissing) return;
  if (!Object.keys(s.proceedsByCcy ?? {}).length && s.proceedsUsd !== 0) return;
  s.proceedsEur = toEur(s.proceedsByCcy, rates);
  if (!s.proceedsByType) return;
  const split = {
    oneTime: toEur(s.proceedsByType.oneTime, rates),
    subscription: toEur(s.proceedsByType.subscription, rates),
    other: toEur(s.proceedsByType.other, rates),
  };
  const keys: SalesProceedsType[] = ["oneTime", "subscription", "other"];
  const largest = keys.reduce((a, b) => Math.abs(split[a]) >= Math.abs(split[b]) ? a : b);
  const residual = Math.round((s.proceedsEur - keys.reduce((n, k) => n + split[k], 0)) * 100) / 100;
  split[largest] = Math.round((split[largest] + residual) * 100) / 100;
  s.proceedsEurByType = split;
}

// Apple publishes a DAILY sales report ~24-48h after the day (longer over weekends), and a fresh
// report can still be regionally partial. The cron used to walk day-1…day-5 and keep only the
// FIRST report with rows — a day that was never "the newest" at any run (the 2026-07-20 FormatFox
// Pro refund: 37 app-days in total) was skipped for good. Collect EVERY day in the trailing window
// instead; the store upserts by day, so re-writing a day is how a partial one gets healed. The
// reports are fetched in parallel (one small account-wide gzip each) so the window costs about one
// round-trip of wall-clock, not five, ahead of the per-app work under Vercel's 60s cap.
export const SALES_WINDOW_DAYS = 5;

export async function collectSalesWindow(
  fetchTsv: FetchSalesTsv, apps: SalesAppRef[], day: string, windowDays = SALES_WINDOW_DAYS,
): Promise<Record<string, SalesDay[]>> {
  const days = Array.from({ length: windowDays }, (_, i) => addDays(day, i - windowDays)); // oldest first
  const results = await Promise.all(days.map((d) => collectSales(fetchTsv, apps, d)));
  const out: Record<string, SalesDay[]> = {};
  for (const res of results) for (const [appId, sd] of Object.entries(res)) (out[appId] ??= []).push(sd);
  return out;
}

export const ascFetchSalesTsv = (
  key: import("@/lib/asc/jwt").AscKey, vendor: string,
) => async (day: string) => {
  const q = new URLSearchParams({
    "filter[frequency]": "DAILY", "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY", "filter[vendorNumber]": vendor,
    "filter[reportDate]": day, "filter[version]": "1_1",
  });
  return (await import("@/lib/asc/client")).ascGetGzipTsv(key, `/v1/salesReports?${q}`);
};
