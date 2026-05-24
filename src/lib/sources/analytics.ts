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
