import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTsv } from "@/lib/asc/client";
import { collectSales } from "@/lib/sources/sales";

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
  });
  expect(rows["6480000000"]).toBeUndefined();
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
