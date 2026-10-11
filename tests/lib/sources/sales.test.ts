import { test, expect, describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTsv } from "@/lib/asc/client";
import { collectSales, collectSalesWindow, parseSalesRows, convertSalesDayToEur } from "@/lib/sources/sales";

const tsv = readFileSync(__dirname + "/../../fixtures/sales-2026-05-18.tsv", "utf8");

test("collectSales aggregates units per app/day/country", async () => {
  const rows = await collectSales(
    async () => parseTsv(tsv),
    [{ appId: "6767226388", sku: "appone-sku" }],
    "2026-05-18",
  );
  expect(rows["6767226388"]).toEqual({
    day: "2026-05-18",
    byCountry: { DE: 5, NL: 3 },
    total: 8,
    redownloads: 1,
    proceedsUsd: 0,
    proceedsByCcy: {}, // free app, no proceeds → empty currency bucket
    proceedsByType: { oneTime: {}, subscription: {}, other: {} },
    otherProductTypes: [], reportAvailable: true, collectedAt: expect.any(String),
  });
  expect(rows["6480000000"]).toBeUndefined();
});

describe("sales revenue classification and coverage", () => {
  const apps = [{ appId: "100", sku: "sample-app" }, { appId: "200", sku: "quiet-app" }];
  const sale = (type: string, units: string, proceeds: string, currency = "EUR") => ({
    "Apple Identifier": "101", "SKU": "sample-product", "Units": units,
    "Country Code": "DE", "Product Type Identifier": type, "Developer Proceeds": proceeds,
    "Parent Identifier": "sample-app", "Currency of Proceeds": currency,
  });

  it("separates IA1, IAY and unknown types while retaining refunds and currency", () => {
    const out = parseSalesRows([
      sale("IA1", "2", "3", "EUR"), sale("IA1", "-1", "3", "EUR"),
      sale("IAY", "3", "4", "USD"), sale("OTHER_NEW_TYPE", "1", "2", "GBP"),
    ], apps, "2026-10-08", "2026-10-10T12:00:00Z");
    expect(out["100"].proceedsByType).toEqual({ oneTime: { EUR: 3 }, subscription: { USD: 12 }, other: { GBP: 2 } });
    expect(out["100"].otherProductTypes).toEqual(["OTHER_NEW_TYPE"]);
    expect(out["100"].proceedsByCcy).toEqual({ EUR: 3, USD: 12, GBP: 2 });
    convertSalesDayToEur(out["100"], { USD: 2, GBP: 2 });
    expect(out["100"].proceedsEurByType).toEqual({ oneTime: 3, subscription: 6, other: 1 });
    expect(out["100"].proceedsEur).toBe(10);
  });

  it("advances a zero-sale app only when an account report is actually available", () => {
    const out = parseSalesRows([sale("IA1", "1", "3")], apps, "2026-10-08", "2026-10-10T12:00:00Z");
    convertSalesDayToEur(out["200"], {});
    expect(out["200"]).toMatchObject({ reportAvailable: true, collectedAt: "2026-10-10T12:00:00Z", proceedsEur: 0, proceedsEurByType: { oneTime: 0, subscription: 0, other: 0 } });
    expect(parseSalesRows([], apps, "2026-10-09")).toEqual({});
  });

  it("keeps rounding cents reconciled to the total", () => {
    const s = parseSalesRows([sale("IA1", "1", "1", "USD"), sale("IAY", "1", "1", "USD")], apps, "2026-10-08")["100"];
    convertSalesDayToEur(s, { USD: 3 });
    expect(s.proceedsEur).toBe(0.67);
    expect(s.proceedsEurByType).toEqual({ oneTime: 0.34, subscription: 0.33, other: 0 });
  });

  it("does not present a partial currency map as fully classified EUR revenue", () => {
    const s = parseSalesRows([sale("IA1", "1", "3"), sale("IAY", "1", "4", "")], apps, "2026-10-08")["100"];
    convertSalesDayToEur(s, {});
    expect(s.proceedsCurrencyMissing).toBe(true);
    expect(s.proceedsEurByType).toBeUndefined();
    expect(s.proceedsEur).toBeUndefined();
  });

  it("rejects invalid report shapes and fractional unit counts", () => {
    expect(() => parseSalesRows([{ error: "upstream response" }], apps, "2026-10-08")).toThrow("columns");
    expect(() => parseSalesRows([sale("IA1", "1.5", "3")], apps, "2026-10-08")).toThrow("invalid amounts");
  });
});

// Real-world shape (NetGuard, 2026-06-02): the app is a free download (Product Type "1",
// proceeds 0) but its "NetGuard Pro" IAP sold twice. IAP rows are reported under the IAP's
// OWN Apple Identifier (6773486248), NOT the app's (6773480175), and link back to the app
// via Parent Identifier = the app's SKU. Those proceeds must land on the parent app.
const IAP_HEADER =
  "Apple Identifier\tSKU\tUnits\tCountry Code\tProduct Type Identifier\tDeveloper Proceeds\tParent Identifier";
const iapTsv = (rows: string[]) => [IAP_HEADER, ...rows].join("\n");

test("collectSales attributes IAP proceeds to the parent app via Parent Identifier", async () => {
  const text = iapTsv([
    "6773480175\tnetguard-ios-v1\t5\tDE\t1\t0.00\t",
    "6773480175\tnetguard-ios-v1\t4\tUS\t1\t0.00\t",
    "6773486248\tde.levinschwab.netguard.pro.lifetime\t1\tDE\tIA1\t3.56\tnetguard-ios-v1",
    "6773486248\tde.levinschwab.netguard.pro.lifetime\t1\tGB\tIA1\t2.82\tnetguard-ios-v1",
    "9999999999\tsomeoneelse-app\t2\tDE\t1\t0.00\t",
  ]);
  const rows = await collectSales(
    async () => parseTsv(text),
    [{ appId: "6773480175", sku: "netguard-ios-v1" }],
    "2026-06-02",
  );
  // downloads still counted from the app's own rows, untouched by IAP attribution
  expect(rows["6773480175"].total).toBe(9);
  expect(rows["6773480175"].byCountry).toEqual({ DE: 5, US: 4 });
  // the two Pro purchases attributed to the parent app
  expect(rows["6773480175"].proceedsUsd).toBeCloseTo(6.38, 2);
  // the IAP's own identifier never becomes its own app entry
  expect(rows["6773486248"]).toBeUndefined();
  // a different vendor app not in the tracked set is ignored
  expect(rows["9999999999"]).toBeUndefined();
});

test("collectSales attributes IAP proceeds even when the app had no own rows that day", async () => {
  const text = iapTsv([
    "6773486248\tde.levinschwab.netguard.pro.lifetime\t1\tDE\tIA1\t3.56\tnetguard-ios-v1",
  ]);
  const rows = await collectSales(
    async () => parseTsv(text),
    [{ appId: "6773480175", sku: "netguard-ios-v1" }],
    "2026-06-02",
  );
  expect(rows["6773480175"].proceedsUsd).toBeCloseTo(3.56, 2);
  expect(rows["6773480175"].total).toBe(0);
  expect(rows["6773480175"].byCountry).toEqual({});
});

// Apple reports IAP proceeds in each sale's own "Currency of Proceeds" — the real NetGuard Pro sold
// in EUR, GBP and BRL the same month. collectSales keeps the raw lump (legacy proceedsUsd) but must
// ALSO bucket per currency so lib/fx can convert the lump to one honest EUR figure (18.49 BRL is ~3 €,
// not 18.49 €). This is the data the FX fix relies on.
test("collectSales buckets proceeds by their reported Currency of Proceeds", async () => {
  const header =
    "Apple Identifier\tSKU\tUnits\tCountry Code\tProduct Type Identifier\tDeveloper Proceeds\tParent Identifier\tCurrency of Proceeds";
  const text = [
    header,
    "6773486248\tnetguard.pro\t1\tDE\tIA1\t3.56\tnetguard-ios-v1\tEUR",
    "6773486248\tnetguard.pro\t1\tGB\tIA1\t2.82\tnetguard-ios-v1\tGBP",
    "6773486248\tnetguard.pro\t1\tBR\tIA1\t18.49\tnetguard-ios-v1\tBRL",
  ].join("\n");
  const rows = await collectSales(
    async () => parseTsv(text),
    [{ appId: "6773480175", sku: "netguard-ios-v1" }],
    "2026-06-23",
  );
  // legacy raw lump = unconverted sum across currencies (the old, overstated number)
  expect(rows["6773480175"].proceedsUsd).toBeCloseTo(24.87, 2);
  // split by currency so fx.toEur can convert each correctly
  expect(rows["6773480175"].proceedsByCcy).toEqual({ EUR: 3.56, GBP: 2.82, BRL: 18.49 });
});

// The cron used to take the FIRST lag day (day-1…day-5) that had rows and write only that one.
// A day that was never "the newest available" at any run — e.g. the 2026-07-20 FormatFox Pro
// refund (Units -1) — was skipped for good, so the dashboard overstated proceeds by 3.71 €.
// collectSalesWindow must return EVERY day in the trailing window that has rows for the batch.
describe("collectSalesWindow", () => {
  const header = IAP_HEADER + "\tCurrency of Proceeds";
  const dayRows = (units: string, proceeds: string) => parseTsv([
    header,
    `6773480175\tnetguard\t1\tDE\t1\t0\t\t`,
    `6773486248\tnetguard.pro\t${units}\tUS\tIA1\t${proceeds}\tnetguard\tUSD`,
  ].join("\n"));

  it("returns every lag day that has rows, oldest first, not just the newest", async () => {
    const fetched: string[] = [];
    const fetchTsv = async (day: string) => {
      fetched.push(day);
      if (day === "2026-07-17") return dayRows("1", "4.24");   // the sale
      if (day === "2026-07-20") return dayRows("-1", "4.24");  // its refund three days later
      if (day === "2026-07-21") return [];                      // Apple hasn't published it yet
      return dayRows("0", "0");                                 // free downloads only
    };
    const out = await collectSalesWindow(fetchTsv, [{ appId: "6773480175", sku: "netguard" }], "2026-07-22");
    expect(fetched).toEqual(["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21"]);
    const days = out["6773480175"];
    expect(days.map((d) => d.day)).toEqual(["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]);
    expect(days[0].proceedsByCcy).toEqual({ USD: 4.24 });
    expect(days[3].proceedsByCcy).toEqual({ USD: -4.24 }); // the refund lands as a negative day
  });

  it("returns nothing for an app with no rows anywhere in the window", async () => {
    const out = await collectSalesWindow(async () => [], [{ appId: "6773480175", sku: "netguard" }], "2026-07-22");
    expect(out).toEqual({});
  });
});
