// EUR foreign-exchange for App Store "Developer Proceeds". Apple reports each sale in its own local
// "Currency of Proceeds" (EUR, GBP, BRL, …). Summing those raw numbers as if they were one currency
// overstated revenue — an 18.49 BRL sale (~3 €) was counted as 18.49 €. We convert each currency to
// EUR with the ECB daily reference rates served by frankfurter.dev (free, no API key, ECB-sourced).

// EUR-base rates as returned by frankfurter: { USD: 1.1392, GBP: 0.862, BRL: 5.8925 } means 1 EUR = X CCY.
export type EurRates = Record<string, number>;

// Static fallback (1 EUR = X CCY, rough mid-2026) for currencies the ECB feed omits (e.g. COP) or
// when the live fetch fails. Better an approximate EUR value than counting foreign money at face
// value. The live feed covers the major ECB currencies; this just backstops the gaps.
const FALLBACK: EurRates = {
  USD: 1.10, GBP: 0.85, BRL: 6.0, MXN: 20, CAD: 1.5, SEK: 11, NOK: 11.5, DKK: 7.46,
  CHF: 0.95, AUD: 1.65, NZD: 1.8, JPY: 170, CNY: 7.9, INR: 92, KRW: 1500, TRY: 44,
  PLN: 4.3, CZK: 25, HUF: 395, RON: 5.0, ZAR: 20, SGD: 1.45, HKD: 8.6, THB: 39,
  IDR: 17500, PHP: 62, MYR: 5.1, ILS: 4.0, AED: 4.04, SAR: 4.13, COP: 4400, CLP: 1050,
  PEN: 4.1, ARS: 1300, BGN: 1.96, RUB: 100, UAH: 45, VND: 28000, TWD: 35,
  // Remaining App Store payout currencies the ECB feed omits, so an exotic-territory sale still converts.
  EGP: 54, NGN: 1750, KZT: 580, QAR: 4.0, PKR: 310, TZS: 2900, KES: 145, MAD: 10.8,
};

// Fetch ECB reference rates for a given UTC day (YYYY-MM-DD), EUR-based. Frankfurter clamps a
// weekend/holiday date to the previous publication day automatically.
export async function fetchEurRates(day: string): Promise<EurRates> {
  const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=EUR`);
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const json = (await res.json()) as { rates?: Record<string, number> };
  return json.rates ?? {};
}

// Convert a per-currency proceeds map to a single EUR total. EUR (and an empty/unknown blank code)
// passes through 1:1; every other currency is divided by its EUR rate (live, then static fallback,
// then 1:1 as a last resort). Returns 0 for an empty/absent map.
export function toEur(byCcy: Record<string, number> | undefined, rates: EurRates): number {
  if (!byCcy) return 0;
  let eur = 0;
  for (const [ccy, amount] of Object.entries(byCcy)) {
    if (!amount) continue;
    if (ccy === "EUR" || ccy === "") { eur += amount; continue; }
    const rate = rates[ccy] ?? FALLBACK[ccy];
    if (!rate || rate <= 0) {
      // No EUR rate (currency absent from both the live ECB feed and FALLBACK). Skip it rather than
      // add the raw foreign amount as EUR — adding it raw is exactly the over-count bug this module
      // exists to prevent. A skipped row slightly under-counts, but never silently inflates revenue.
      console.warn(`fx.toEur: no EUR rate for "${ccy}"; excluded ${amount} from the EUR total`);
      continue;
    }
    eur += amount / rate;
  }
  return Math.round(eur * 100) / 100;
}
