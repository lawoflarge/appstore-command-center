import { ascGetAllPages, ascGetJson as ascGetJsonImpl } from "@/lib/asc/client";
import type { AscKey } from "@/lib/asc/jwt";
import { gunzipSync } from "node:zlib";

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

export async function fetchLatestAnalyticsCsv(key: AscKey, requestId: string): Promise<string> {
  const reports = await ascGetAllPages(key, `/v1/analyticsReportRequests/${requestId}/reports?limit=200`);
  let csv = "";
  for (const rep of reports) {
    // ASC rejects `sort` on this endpoint (PARAMETER_ERROR.ILLEGAL). Don't paginate — the
    // single page can hold ~200 historical instances and walking all pages blew the 60s
    // Hobby function limit. Fetch ONE page only, then sort client-side and take the newest.
    const page = await ascGetJsonImpl<{ data: any[] }>(
      key, `/v1/analyticsReports/${rep.id}/instances?limit=200`);
    const instances = (page.data ?? []).slice().sort((a: any, b: any) =>
      String(b.attributes?.processingDate ?? "").localeCompare(String(a.attributes?.processingDate ?? "")));
    const latest = instances[0];
    if (!latest) continue;
    const segments = await ascGetAllPages(
      key, `/v1/analyticsReportInstances/${latest.id}/segments?limit=200`);
    for (const seg of segments) {
      const res = await fetch(seg.attributes.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      let text: string;
      try { text = gunzipSync(buf).toString("utf8"); }
      catch { text = buf.toString("utf8"); }
      csv += (csv && !csv.endsWith("\n") ? "\n" : "") + text;
    }
  }
  return csv;
}
