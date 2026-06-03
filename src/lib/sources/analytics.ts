import type { AnalyticsDay } from "@/lib/store/paths";

// ASC's analytics CSVs are long-format (one row per dimension combination, value
// in `Counts`). Two report shapes we care about:
//   - "App Downloads Standard": has `Download Type` + `Source Type` + `Counts`.
//     First-time download counts → AnalyticsDay.downloads.
//   - "App Store Discovery and Engagement Standard": has `Event` + `Source Type` + `Counts`.
//     Event = "Impression" → impressions; "Page view" → pageViews.
// Delimiter is tab in Apple's actual output; comma supported for fixtures.
//
// Apple sends one CSV per segment per instance. We accept an array of chunks so
// the caller can pass however many segments were fetched without having to
// concatenate (concatenation breaks the header-on-line-1 contract).
export function parseAnalyticsCsvs(chunks: string[]): Record<string, AnalyticsDay> {
  const acc: Record<string, AnalyticsDay> = {};
  for (const text of chunks) mergeChunkInto(acc, text);
  return acc;
}

export function parseAnalyticsCsv(text: string): Record<string, AnalyticsDay> {
  const acc: Record<string, AnalyticsDay> = {};
  mergeChunkInto(acc, text);
  return acc;
}

export interface AnalyticsCsvGroup { report: string; processingDate: string; segments: string[] }

// One ONGOING DAILY report produces many instances, each restating a rolling window of recent
// dates — so the SAME calendar date appears in several instances. Summing every instance
// double-counts those dates (the NetGuard 26-vs-13 bug). Per report, take each date from its
// NEWEST instance only; segments WITHIN an instance are non-overlapping partitions and are
// still summed. The two report shapes write disjoint fields (downloads/bySource vs
// impressions/pageViews), so merging per date across reports stays correct.
export function parseAnalyticsGroups(groups: AnalyticsCsvGroup[]): Record<string, AnalyticsDay> {
  const byReport = new Map<string, AnalyticsCsvGroup[]>();
  for (const g of groups) {
    const list = byReport.get(g.report);
    if (list) list.push(g); else byReport.set(g.report, [g]);
  }
  const acc: Record<string, AnalyticsDay> = {};
  for (const insts of byReport.values()) {
    const newestFirst = [...insts].sort((a, b) => b.processingDate.localeCompare(a.processingDate));
    const claimed = new Set<string>();
    for (const inst of newestFirst) {
      const one: Record<string, AnalyticsDay> = {};
      for (const csv of inst.segments) mergeChunkInto(one, csv);
      for (const day of Object.keys(one)) {
        if (claimed.has(day)) continue; // a newer instance of this report already supplied this date
        claimed.add(day);
        mergeDayInto(acc, one[day]);
      }
    }
  }
  return acc;
}

function mergeDayInto(acc: Record<string, AnalyticsDay>, d: AnalyticsDay): void {
  const t = (acc[d.day] ??= emptyDay(d.day));
  t.impressions += d.impressions;
  t.pageViews += d.pageViews;
  t.downloads += d.downloads;
  for (const [src, n] of Object.entries(d.bySource)) t.bySource[src] = (t.bySource[src] ?? 0) + n;
}

function mergeChunkInto(acc: Record<string, AnalyticsDay>, text: string): void {
  if (!text || !text.trim()) return;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim);
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("Date");
  const iCounts = idx("Counts");
  if (iDate < 0 || iCounts < 0) return;
  const iDownloadType = idx("Download Type");
  const iEvent = idx("Event");
  const iSource = idx("Source Type");
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const day = cells[iDate];
    if (!day) continue;
    const n = num(cells[iCounts]);
    if (n === 0) continue;
    const d = (acc[day] ??= emptyDay(day));
    if (iDownloadType >= 0) {
      if (cells[iDownloadType] === "First-time download") {
        d.downloads += n;
        const src = iSource >= 0 ? cells[iSource] : "";
        if (src) d.bySource[src] = (d.bySource[src] ?? 0) + n;
      }
    } else if (iEvent >= 0) {
      const ev = cells[iEvent];
      if (ev === "Impression") d.impressions += n;
      else if (ev === "Page view") d.pageViews += n;
    }
  }
}

function emptyDay(day: string): AnalyticsDay {
  return { day, impressions: 0, pageViews: 0, downloads: 0, sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {} };
}

function num(v: string): number {
  return parseInt((v || "0").replace(/[^0-9-]/g, ""), 10) || 0;
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
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
