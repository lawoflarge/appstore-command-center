import type { AnalyticsDay } from "@/lib/store/paths";

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = cells[i] ?? ""));
    return o;
  });
}
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v: string) => parseInt((v || "0").replace(/[^0-9-]/g, ""), 10) || 0;

export function parseAnalyticsCsv(text: string): Record<string, AnalyticsDay> {
  const rows = parseCsv(text);
  const acc: Record<string, AnalyticsDay> = {};
  for (const r of rows) {
    const day = r["Date"];
    if (!day) continue;
    const d = (acc[day] ??= {
      day, impressions: 0, pageViews: 0, downloads: 0, sessions: 0,
      activeDevices: 0, deletions: 0, crashes: 0, bySource: {},
    });
    d.impressions += num(r["Impressions"]);
    d.pageViews += num(r["Product Page Views"]);
    d.downloads += num(r["App Units"]);
    d.sessions += num(r["Sessions"]);
    d.activeDevices += num(r["Active Devices"]);
    d.deletions += num(r["Deletions"]);
    d.crashes += num(r["Crashes"]);
    const src = r["Source Type"];
    if (src) d.bySource[src] = (d.bySource[src] ?? 0) + num(r["App Units"]);
  }
  return acc;
}

export async function ensureOngoingRequest(
  appId: string,
  list: (appId: string) => Promise<{ id: string }[]>,
  create: (appId: string) => Promise<{ id: string }>,
): Promise<string> {
  const existing = await list(appId);
  if (existing.length > 0) return existing[0].id;
  return (await create(appId)).id;
}
