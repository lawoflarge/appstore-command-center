import type { SalesDay, SalesProceedsType } from "@/lib/store/paths";
import { convertSalesDayToEur } from "./sales";
import type { EurRates } from "@/lib/fx";

export type BackfillKind = "zero" | "single_type" | "single_currency" | "verified_fx";
export type PreparedBackfill = { kind: BackfillKind; row: SalesDay } | { kind: "exception"; reason: string };
const TYPES: SalesProceedsType[] = ["oneTime", "subscription", "other"];
const cents = (n: number) => Math.round(n * 100) / 100;
const nonzeroCurrencies = (map: Record<string, number> = {}) => Object.keys(map).filter((c) => Math.abs(map[c]) > 0.000001).sort();

// Backfills enrich existing rows; historical totals, currencies, downloads and extra fields
// remain authoritative. An upstream correction requires its own review, not a silent rewrite.
export function prepareSalesBackfill(existing: SalesDay, incoming: SalesDay, rates?: EurRates): PreparedBackfill {
  if (existing.day !== incoming.day || !incoming.reportAvailable || !incoming.proceedsByType || incoming.proceedsCurrencyMissing) {
    return { kind: "exception", reason: "Incomplete source report or mismatched day" };
  }
  const before = existing.proceedsByCcy ?? {};
  const after = incoming.proceedsByCcy ?? {};
  const currencies = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (currencies.some((c) => Math.abs((before[c] ?? 0) - (after[c] ?? 0)) > 0.000001) ||
    Math.abs(existing.proceedsUsd - incoming.proceedsUsd) > 0.000001) {
    return { kind: "exception", reason: "Raw currency totals differ from stored proceeds" };
  }
  const total = existing.proceedsEur ?? (existing.proceedsUsd === 0 ? 0 : undefined);
  if (total === undefined || !Number.isFinite(total)) return { kind: "exception", reason: "No stored EUR total to reconcile" };
  const active = TYPES.filter((type) => nonzeroCurrencies(incoming.proceedsByType![type]).length);
  let kind: BackfillKind;
  let split = { oneTime: 0, subscription: 0, other: 0 };
  if (!active.length && total === 0) {
    kind = "zero";
  } else if (active.length === 1) {
    kind = "single_type";
    split[active[0]] = total;
  } else {
    const used = [...new Set(TYPES.flatMap((type) => nonzeroCurrencies(incoming.proceedsByType![type])))];
    const rawTotal = used.reduce((n, c) => n + (after[c] ?? 0), 0);
    if (used.length === 1 && Math.abs(rawTotal) > 0.000001) {
      kind = "single_currency";
      for (const type of TYPES) split[type] = cents(total * (incoming.proceedsByType[type][used[0]] ?? 0) / rawTotal);
    } else {
      if (!rates || used.some((c) => c !== "EUR" && !(rates[c] > 0))) {
        return { kind: "exception", reason: "Multiple types require verified report-day FX rates" };
      }
      const converted = { ...incoming };
      convertSalesDayToEur(converted, rates);
      if (converted.proceedsEur === undefined || Math.abs(converted.proceedsEur - total) > 0.000001 || !converted.proceedsEurByType) {
        return { kind: "exception", reason: "Verified report-day FX does not reproduce stored EUR total" };
      }
      kind = "verified_fx";
      split = { ...converted.proceedsEurByType };
    }
    const largest = TYPES.reduce((a, b) => Math.abs(split[a]) >= Math.abs(split[b]) ? a : b);
    split[largest] = cents(split[largest] + total - TYPES.reduce((n, k) => n + split[k], 0));
  }
  if (Math.abs(TYPES.reduce((n, k) => n + split[k], 0) - total) > 0.000001) {
    return { kind: "exception", reason: "Classified amounts do not reconcile to the stored total" };
  }
  return {
    kind,
    row: {
      ...existing,
      proceedsByType: incoming.proceedsByType,
      proceedsEurByType: split,
      otherProductTypes: incoming.otherProductTypes ?? [],
      reportAvailable: true,
      collectedAt: incoming.collectedAt,
    },
  };
}
