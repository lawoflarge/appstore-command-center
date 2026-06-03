import type { SalesDay } from "@/lib/store/paths";

export type FetchSalesTsv = (day: string) => Promise<Record<string, string>[]>;
export interface SalesAppRef { appId: string; sku: string }
const DOWNLOAD = new Set(["1", "1F", "1T", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["1R", "1FR"]);

export async function collectSales(
  fetchTsv: FetchSalesTsv, apps: SalesAppRef[], day: string,
): Promise<Record<string, SalesDay>> {
  const rows = await fetchTsv(day);
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
    (acc[appId] ??= { day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: 0 });

  for (const r of rows) {
    const appId = r["Apple Identifier"];
    const units = parseInt(r["Units"] || "0", 10);
    const proceeds = parseFloat(r["Developer Proceeds"] || "0") || 0;
    if (want.has(appId)) {
      const ptype = (r["Product Type Identifier"] || "").trim();
      const s = ensure(appId);
      if (DOWNLOAD.has(ptype)) {
        s.byCountry[r["Country Code"]] = (s.byCountry[r["Country Code"]] ?? 0) + units;
        s.total += units;
      } else if (REDOWNLOAD.has(ptype)) {
        s.redownloads += units;
      }
      s.proceedsUsd += proceeds * units;
    } else if (proceeds) {
      // An IAP / subscription row — credit its proceeds to the parent app it belongs to.
      const parent = skuToApp.get((r["Parent Identifier"] || "").trim());
      if (parent) ensure(parent).proceedsUsd += proceeds * units;
    }
  }
  return acc;
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
