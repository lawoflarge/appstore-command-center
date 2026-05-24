import { ascGetAllPages, ascGetJson as ascGetJsonImpl } from "@/lib/asc/client";
import type { AscKey } from "@/lib/asc/jwt";
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

// Returns one CSV string per fetched segment. Parser merges by Date. Don't
// concatenate here — concatenation puts multiple header rows in one string,
// which any header-on-line-1 parser misreads.
export async function fetchLatestAnalyticsCsv(key: AscKey, requestId: string): Promise<string[]> {
  const reports = await ascGetAllPages(key, `/v1/analyticsReportRequests/${requestId}/reports?limit=200`);
  const targets = reports.filter((r: any) =>
    typeof r.attributes?.name === "string" && ANALYTICS_REPORT_NAMES.has(r.attributes.name));
  const chunks: string[] = [];
  for (const rep of targets) {
    const page = await ascGetJsonImpl<{ data: any[] }>(
      key, `/v1/analyticsReports/${rep.id}/instances?limit=200`);
    const dailies = (page.data ?? [])
      .filter((i: any) => i.attributes?.granularity === "DAILY")
      .sort((a: any, b: any) =>
        String(b.attributes?.processingDate ?? "").localeCompare(String(a.attributes?.processingDate ?? "")))
      .slice(0, DAILY_INSTANCES_PER_REPORT);
    for (const inst of dailies) {
      const segments = await ascGetAllPages(
        key, `/v1/analyticsReportInstances/${inst.id}/segments?limit=200`);
      for (const seg of segments) {
        const res = await fetch(seg.attributes.url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        let text: string;
        try { text = gunzipSync(buf).toString("utf8"); }
        catch { text = buf.toString("utf8"); }
        chunks.push(text);
      }
    }
  }
  return chunks;
}
