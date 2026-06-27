import { test, expect } from "vitest";
import { toEur } from "@/lib/fx";

// 1 EUR = X CCY — the frankfurter/ECB shape for 2026-06-23 (the day NetGuard's BRL sale landed).
const RATES = { USD: 1.1392, GBP: 0.862, BRL: 5.8925 };

test("toEur passes EUR through 1:1 and converts foreign currencies by dividing by the EUR rate", () => {
  expect(toEur({ EUR: 3.56 }, RATES)).toBe(3.56);
  expect(toEur({ BRL: 18.49 }, RATES)).toBeCloseTo(3.14, 2); // 18.49 / 5.8925
  expect(toEur({ GBP: 2.82 }, RATES)).toBeCloseTo(3.27, 2);  // 2.82 / 0.862
});

test("toEur sums a mixed-currency proceeds map into one EUR total (the NetGuard June bug)", () => {
  // The real NetGuard Pro June sales: 7.12 EUR + 2.82 GBP + 3.39 USD + 18.49 BRL. Summed raw that
  // is 31.82 (the overstated dashboard number); converted it is ~16.5 €.
  expect(toEur({ EUR: 7.12, GBP: 2.82, USD: 3.39, BRL: 18.49 }, RATES)).toBeCloseTo(16.51, 1);
});

test("toEur falls back to the static table for a currency missing from the live feed", () => {
  // COP is not in the ECB feed; the static fallback (~4400/€) keeps it from being counted at face value.
  expect(toEur({ COP: 4400 }, {})).toBeCloseTo(1.0, 1);
});

test("toEur is empty-safe", () => {
  expect(toEur({}, RATES)).toBe(0);
  expect(toEur(undefined, RATES)).toBe(0);
});
