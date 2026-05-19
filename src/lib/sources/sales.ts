import type { SalesDay } from "@/lib/store/paths";

export type FetchSalesTsv = (day: string) => Promise<Record<string, string>[]>;
const DOWNLOAD = new Set(["1", "1F", "1T", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["1R", "1FR"]);

export async function collectSales(
  fetchTsv: FetchSalesTsv, appIds: string[], day: string,
): Promise<Record<string, SalesDay>> {
  const rows = await fetchTsv(day);
  const want = new Set(appIds);
  const acc: Record<string, SalesDay> = {};
  for (const r of rows) {
    const appId = r["Apple Identifier"];
    if (!want.has(appId)) continue;
    const units = parseInt(r["Units"] || "0", 10);
    const ptype = (r["Product Type Identifier"] || "").trim();
    const proceeds = parseFloat(r["Developer Proceeds"] || "0") || 0;
    const s = (acc[appId] ??= { day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: 0 });
    if (DOWNLOAD.has(ptype)) {
      s.byCountry[r["Country Code"]] = (s.byCountry[r["Country Code"]] ?? 0) + units;
      s.total += units;
    } else if (REDOWNLOAD.has(ptype)) {
      s.redownloads += units;
    }
    s.proceedsUsd += proceeds * units;
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
