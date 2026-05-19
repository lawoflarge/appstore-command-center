import { test, expect } from "vitest";
import { downloadsSeries, totals } from "@/lib/aggregate/downloads";

const sales = [
  { day: "2026-05-17", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 },
  { day: "2026-05-18", byCountry: { DE: 7, US: 1 }, total: 8, redownloads: 0, proceedsUsd: 0 },
];

test("downloadsSeries returns {day,value}", () => {
  expect(downloadsSeries(sales)).toEqual([
    { day: "2026-05-17", value: 5 }, { day: "2026-05-18", value: 8 },
  ]);
});

test("totals computes total + today + delta", () => {
  expect(totals(sales, "2026-05-18")).toEqual({ total: 13, today: 8, prev: 5, deltaPct: 60 });
});
