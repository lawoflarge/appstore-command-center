import { ascGetAllPages, ascGetJson as ascGetJsonImpl } from "@/lib/asc/client";
import type { AscKey } from "@/lib/asc/jwt";
import type { AnalyticsCsvGroup } from "@/lib/sources/analytics";
import { gunzipSync } from "node:zlib";

// Apple emits 150+ analytics reports per ongoing request; only these two carry
// the metrics that match ASC's "Analytics → Overview" UI (downloads,
// impressions, page views). Walking the rest blows the 60s function cap.
const ANALYTICS_REPORT_NAMES = new Set([
  "App Downloads Standard",
  "App Store Discovery and Engagement Standard",
]);

// Each DAILY instance covers ~1–3 days. 14 newest instances ≈ rolling fortnight.
const DAILY_INSTANCES_PER_REPORT = 14;

export async function listOngoingRequests(key: AscKey, appId: string) {
  const rows = await ascGetAllPages(
    key, `/v1/apps/${appId}/analyticsReportRequests?limit=200`);
  return rows.filter((r: any) => r.attributes?.accessType === "ONGOING").map((r: any) => ({ id: r.id }));
}

export async function createOngoingRequest(key: AscKey, appId: string) {
  const { ascGetJson } = await import("@/lib/asc/client");
  const res = await fetch("https://api.appstoreconnect.apple.com/v1/analyticsReportRequests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${(await import("@/lib/asc/jwt")).signAscToken(key)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: { type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: appId } } } },
    }),
  });
  if (!res.ok) throw new Error(`create report request ${res.status}`);
  const j = (await res.json()) as any;
  void ascGetJson;
  return { id: j.data.id as string };
}

// Returns one group per report instance (its segment CSVs + recency), so the parser can
// dedupe overlapping daily instances by date instead of summing them. Don't concatenate
// segments here — concatenation puts multiple header rows in one string, which any
// header-on-line-1 parser misreads.
export async function fetchLatestAnalyticsCsv(key: AscKey, requestId: string): Promise<AnalyticsCsvGroup[]> {
  const reports = await ascGetAllPages(key, `/v1/analyticsReportRequests/${requestId}/reports?limit=200`);
  const targets = reports.filter((r: any) =>
    typeof r.attributes?.name === "string" && ANALYTICS_REPORT_NAMES.has(r.attributes.name));
  const groups: AnalyticsCsvGroup[] = [];
  let failed = 0;         // per-instance /segments fetches that threw (Apple 5xx)
  let listFailures = 0;   // reports whose /instances listing call itself threw
  for (const rep of targets) {
    const name = rep.attributes.name as string;
    let dailies: any[];
    try {
      // The /instances listing shares the same throwing, no-retry primitive as /segments and is just as
      // exposed to Apple's intermittent 5xx. Guard it PER REPORT so one report's transient list failure
      // can't discard another report's already-collected groups (Downloads + Engagement are independent).
      const page = await ascGetJsonImpl<{ data: any[] }>(
        key, `/v1/analyticsReports/${rep.id}/instances?limit=200`);
      dailies = (page.data ?? [])
        .filter((i: any) => i.attributes?.granularity === "DAILY")
        .sort((a: any, b: any) =>
          String(b.attributes?.processingDate ?? "").localeCompare(String(a.attributes?.processingDate ?? "")))
        .slice(0, DAILY_INSTANCES_PER_REPORT);
    } catch (err) {
      listFailures++;
      console.warn(`analytics: instances listing for "${name}" failed, skipping report: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    let repFailed = 0;
    for (const inst of dailies) {
      // Apple's /segments endpoint intermittently returns a sticky HTTP 500 (UNEXPECTED_ERROR) for
      // individual daily instances while adjacent dates succeed (verified live 2026-07-02). ascGetAllPages
      // throws on that 500; without this guard one bad instance aborts the WHOLE app's analytics collection
      // and freezes its downloads indefinitely, because the rolling window keeps re-including the broken
      // instance (this caused the 2026-06-23→07-02 portfolio-wide download freeze). Skip the failing
      // instance and keep the rest — overlapping instances usually still supply that date from a neighbor.
      try {
        const segments = await ascGetAllPages(
          key, `/v1/analyticsReportInstances/${inst.id}/segments?limit=200`);
        const csvs: string[] = [];
        for (const seg of segments) {
          const res = await fetch(seg.attributes.url);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          let text: string;
          try { text = gunzipSync(buf).toString("utf8"); }
          catch { text = buf.toString("utf8"); }
          csvs.push(text);
        }
        groups.push({ report: name, processingDate: String(inst.attributes?.processingDate ?? ""), segments: csvs });
      } catch {
        failed++;
        repFailed++;
      }
    }
    // A whole report type silently missing (e.g. every Downloads instance 500s while Engagement is fine) would
    // be marked analytics:ok downstream; leave a log trace so a systematic skip is visible, not invisible.
    if (repFailed > 0) {
      console.warn(`analytics: "${name}" skipped ${repFailed}/${dailies.length} instances (Apple 5xx)`);
    }
  }
  // Return partial data whenever we collected anything. Throw only on a genuine total wipeout — we set out to
  // collect but EVERY attempt errored (all segments failed and/or every report's listing failed) — so the run
  // is marked analytics:failed in run-status instead of silently writing zero rows. A legitimately empty day
  // (no instances yet, no errors) still returns [] — Apple's ~24-48h publication lag makes empty normal.
  if (groups.length === 0 && (failed > 0 || listFailures > 0)) {
    throw new Error(`all analytics instances failed (${failed} segment 500s, ${listFailures} report-list failures)`);
  }
  return groups;
}
