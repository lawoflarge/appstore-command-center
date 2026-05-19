import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTsv } from "@/lib/asc/client";
import { collectSales } from "@/lib/sources/sales";

const tsv = readFileSync(__dirname + "/../../fixtures/sales-2026-05-18.tsv", "utf8");

test("collectSales aggregates units per app/day/country", async () => {
  const rows = await collectSales(async () => parseTsv(tsv), ["6767226388"], "2026-05-18");
  expect(rows["6767226388"]).toEqual({
    day: "2026-05-18",
    byCountry: { DE: 5, NL: 3 },
    total: 8,
    redownloads: 1,
    proceedsUsd: 0,
  });
  expect(rows["6480000000"]).toBeUndefined();
});
