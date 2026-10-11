import type { Env } from "@/env";
import { addDays } from "@/lib/dates";
import type { AdMobReportCoverage } from "@/lib/store/paths";

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
  reportingTimeZone?: string;
  currencyCode?: string;
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

async function publisher(token: string): Promise<{ name: string; reportingTimeZone: string }> {
  const r = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await r.json()) as { account?: { name: string; reportingTimeZone?: string }[] };
  const a = j.account?.[0];
  if (!r.ok || !a?.name || !a.reportingTimeZone) throw new Error("admob: account metadata unavailable");
  return { name: a.name, reportingTimeZone: a.reportingTimeZone };
}

// AdMob report response: a streamed JSON array of { header } / { row } / { footer }.
interface RawCell {
  value?: string;
  displayLabel?: string;
  integerValue?: string;
  microsValue?: string;
}
interface RawPart {
  header?: { dateRange?: unknown; reportingTimeZone?: string; localizationSettings?: { currencyCode?: string } };
  footer?: { warnings?: { type?: string }[]; matchingRowCount?: string | number };
  row?: {
    dimensionValues?: Record<string, RawCell>;
    metricValues?: Record<string, RawCell>;
  };
}

export interface AdMobReport { rows: AdMobRow[]; coverage: AdMobReportCoverage }

function reportDate(value: unknown): string {
  const date = value as { year?: number; month?: number; day?: number } | undefined;
  if (!date || !Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    throw new Error("admob: missing report date range");
  }
  const iso = `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error("admob: invalid report date range");
  return iso;
}

// Coverage comes from the completed provider response, not the date of the last active ad
// unit. A quiet day inside this interval is still part of the linear forecast denominator.
export function parseNetworkReportWithCoverage(
  parts: RawPart[], collectedAt = new Date().toISOString(), account?: { reportingTimeZone: string },
): AdMobReport {
  const header = parts[0]?.header;
  const footer = parts.at(-1)?.footer;
  // Google can omit the default timezone from its report header. Only the freshly
  // fetched metadata of this exact report account may supply that default.
  const reportingTimeZone = header?.reportingTimeZone ?? account?.reportingTimeZone;
  if (!header || !footer || !reportingTimeZone || header.localizationSettings?.currencyCode !== "EUR") {
    throw new Error("admob: report lacks validated coverage, timezone or EUR currency");
  }
  if (footer.warnings?.some((w) => w.type !== "REPORT_CURRENCY_NOT_ACCOUNT_CURRENCY")) {
    throw new Error("admob: provider warnings prevent confirmed date coverage");
  }
  const range = header.dateRange as { startDate?: unknown; endDate?: unknown } | undefined;
  const startDay = reportDate(range?.startDate);
  const endDay = reportDate(range?.endDate);
  if (endDay < startDay) throw new Error("admob: reversed report date range");
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: reportingTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(collectedAt));
  const get = (type: string) => local.find((p) => p.type === type)!.value;
  const yesterday = addDays(`${get("year")}-${get("month")}-${get("day")}`, -1);
  const completeThroughDay = endDay < yesterday ? endDay : yesterday;
  for (const part of parts) {
    for (const cell of Object.values(part.row?.metricValues ?? {})) {
      const value = cell.integerValue ?? cell.microsValue;
      if (value !== undefined && (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        throw new Error("admob: invalid report metric");
      }
    }
  }
  const rows = parseNetworkReport(parts).map((row) => ({ ...row, reportingTimeZone, currencyCode: "EUR" }));
  if (footer.matchingRowCount !== undefined) {
    const count = Number(footer.matchingRowCount);
    // Google documents that this count may differ from emitted rows. Conservatively
    // refuse coverage when more rows matched than were received; do not infer zeroes.
    if (!Number.isSafeInteger(count) || count < 0 || count > rows.length) throw new Error("admob: unconfirmed report row coverage");
  }
  if (rows.some((r) => r.day < startDay || r.day > endDay || !/^\d{4}-\d{2}-\d{2}$/.test(r.day))) {
    throw new Error("admob: row falls outside reported coverage");
  }
  return {
    rows,
    coverage: { startDay, endDay, completeThroughDay, reportingTimeZone, currencyCode: "EUR", collectedAt },
  };
}

const toIsoDay = (raw: string): string =>
  raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;

export function parseNetworkReport(parts: RawPart[]): AdMobRow[] {
  const out: AdMobRow[] = [];
  const header = parts.find((part) => part.header)?.header;
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
      ...(header?.reportingTimeZone ? { reportingTimeZone: header.reportingTimeZone } : {}),
      ...(header?.localizationSettings?.currencyCode ? { currencyCode: header.localizationSettings.currencyCode } : {}),
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
  return (await collectAdmobReport(e, startDay, endDay)).rows;
}

export async function collectAdmobReport(e: Env, startDay: string, endDay: string): Promise<AdMobReport> {
  const token = await accessToken(e);
  const pub = await publisher(token);
  const reportSpec = {
    dateRange: { startDate: ymd(startDay), endDate: ymd(endDay) },
    dimensions: ["DATE", "APP", "AD_UNIT"],
    metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"],
    localizationSettings: { currencyCode: "EUR" },
  };
  const r = await fetch(`${API}/${pub.name}/networkReport:generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reportSpec }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`admob report ${r.status}: ${text.slice(0, 200)}`);
  return parseNetworkReportWithCoverage(JSON.parse(text) as RawPart[], new Date().toISOString(), pub);
}
