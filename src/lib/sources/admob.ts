import type { Env } from "@/env";

// AdMob Reporting API — account-wide earnings. One OAuth refresh token covers
// every app under the publisher account; the networkReport breaks down by app +
// ad unit. Secrets are read only here (server-side). See
// 30_Resources/ios/AdMob-Reporting-API in the brain vault for the setup.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://admob.googleapis.com/v1";

export interface AdMobRow {
  day: string; // YYYY-MM-DD
  appId: string; // AdMob app id (dimension value)
  app: string; // display name
  adUnit: string; // ad-unit display name
  earnings: number; // account currency (EUR), not micros
  impressions: number;
  clicks: number;
  requests: number;
  matchedRequests: number;
  ecpm: number; // earnings per 1000 impressions
}

export function admobConfigured(e: Env): boolean {
  return Boolean(e.ADMOB_CLIENT_ID && e.ADMOB_CLIENT_SECRET && e.ADMOB_REFRESH_TOKEN);
}

async function accessToken(e: Env): Promise<string> {
  const body = new URLSearchParams({
    client_id: e.ADMOB_CLIENT_ID ?? "",
    client_secret: e.ADMOB_CLIENT_SECRET ?? "",
    refresh_token: e.ADMOB_REFRESH_TOKEN ?? "",
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("admob: token refresh failed");
  return j.access_token;
}

async function publisher(token: string): Promise<{ name: string; currency: string }> {
  const r = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await r.json()) as { account?: { name: string; currencyCode?: string }[] };
  const a = j.account?.[0];
  if (!a) throw new Error("admob: no account returned");
  return { name: a.name, currency: a.currencyCode ?? "EUR" };
}

// AdMob report response: a streamed JSON array of { header } / { row } / { footer }.
interface RawCell {
  value?: string;
  displayLabel?: string;
  integerValue?: string;
  microsValue?: string;
}
interface RawPart {
  row?: {
    dimensionValues?: Record<string, RawCell>;
    metricValues?: Record<string, RawCell>;
  };
}

const toIsoDay = (raw: string): string =>
  raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;

export function parseNetworkReport(parts: RawPart[]): AdMobRow[] {
  const out: AdMobRow[] = [];
  for (const p of parts) {
    const row = p.row;
    if (!row) continue;
    const dv = row.dimensionValues ?? {};
    const mv = row.metricValues ?? {};
    const impressions = Number(mv.IMPRESSIONS?.integerValue ?? 0);
    const earnings = Number(mv.ESTIMATED_EARNINGS?.microsValue ?? 0) / 1e6;
    out.push({
      day: toIsoDay(dv.DATE?.value ?? ""),
      appId: dv.APP?.value ?? "unknown",
      app: dv.APP?.displayLabel ?? dv.APP?.value ?? "unknown",
      adUnit: dv.AD_UNIT?.displayLabel ?? dv.AD_UNIT?.value ?? "unknown",
      earnings,
      impressions,
      clicks: Number(mv.CLICKS?.integerValue ?? 0),
      requests: Number(mv.AD_REQUESTS?.integerValue ?? 0),
      matchedRequests: Number(mv.MATCHED_REQUESTS?.integerValue ?? 0),
      ecpm: impressions > 0 ? (earnings / impressions) * 1000 : 0,
    });
  }
  return out;
}

const ymd = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return { year: y, month: m, day: dd };
};

/** Fetch daily AdMob rows (by app + ad unit) for [startDay, endDay] inclusive. */
export async function collectAdmob(e: Env, startDay: string, endDay: string): Promise<AdMobRow[]> {
  const token = await accessToken(e);
  const pub = await publisher(token);
  const reportSpec = {
    dateRange: { startDate: ymd(startDay), endDate: ymd(endDay) },
    dimensions: ["DATE", "APP", "AD_UNIT"],
    metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"],
  };
  const r = await fetch(`${API}/${pub.name}/networkReport:generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reportSpec }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`admob report ${r.status}: ${text.slice(0, 200)}`);
  return parseNetworkReport(JSON.parse(text) as RawPart[]);
}
