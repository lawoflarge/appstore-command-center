import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { ascKeyFromEnv } from "@/lib/asc/jwt";
import { ascFetchSalesTsv, parseSalesRows, convertSalesDayToEur } from "@/lib/sources/sales";
import { prepareSalesBackfill } from "@/lib/sources/revenueBackfill";
import { fetchEurRates, type EurRates } from "@/lib/fx";
import { ghBackendFromEnv, makeStore } from "@/lib/store/store";
import { salesPath, type AppMeta, type SalesDay } from "@/lib/store/paths";

type ReportCache = Record<string, Record<string, string>[]>;
interface PlanFile { path: string; rows: SalesDay[] }

export async function runBackfill(args: string[]) {
  const outputArg = args.find((a) => a.startsWith("--output="));
  if (!outputArg) throw new Error("Provide an absolute private --output directory");
  const output = outputArg.slice("--output=".length);
  if (!path.isAbsolute(output)) throw new Error("Output directory must be absolute");
  const write = args.includes("--write");
  if (write && !args.includes("--confirm-private-data-update")) throw new Error("Writing requires --confirm-private-data-update");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const e = env();
  const backend = ghBackendFromEnv();
  const store = makeStore(backend);
  const snapshot = await backend.snapshot!();
  const apps = [...snapshot.entries()].filter(([p]) => /^data\/\d+\/meta\.json$/.test(p)).map(([, value]) => value as AppMeta);
  const files = [...snapshot.entries()].filter(([p]) => /^data\/\d+\/sales\/\d{4}-\d{2}\.json$/.test(p)) as [string, SalesDay[]][];
  await writeFile(path.join(output, "baseline-sales.json"), JSON.stringify(Object.fromEntries(files)), { mode: 0o600 });
  const dates = [...new Set(files.flatMap(([p, rows]) => rows.filter((r) => p.endsWith(`${r.day.slice(0, 7)}.json`)).map((r) => r.day)))].sort();
  const cachePath = path.join(output, "reports.json");
  const cached: ReportCache = await readFile(cachePath, "utf8").then(JSON.parse).catch(() => ({}));
  const load = ascFetchSalesTsv(ascKeyFromEnv(e), e.ASC_VENDOR_NUMBER);
  const failures: string[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < dates.length) {
      const date = dates[cursor++];
      if (cached[date]?.length) continue;
      try { cached[date] = await load(date); } catch { failures.push(date); }
    }
  }));
  await writeFile(cachePath, JSON.stringify(cached), { mode: 0o600 });
  const parsed = new Map(dates.filter((d) => cached[d]?.length).map((d) => [d, parseSalesRows(cached[d], apps, d)]));
  const rates = new Map<string, EurRates>();
  const counts: Record<string, number> = {};
  const exceptions: { appId: string; day: string; reason: string }[] = [];
  const plan: PlanFile[] = [];
  for (const [file, rows] of files) {
    const appId = file.split("/")[1];
    const updates: SalesDay[] = [];
    for (const previous of rows) {
      if (!file.endsWith(`${previous.day.slice(0, 7)}.json`)) continue;
      const incoming = parsed.get(previous.day)?.[appId];
      if (!incoming) { exceptions.push({ appId, day: previous.day, reason: "Report unavailable" }); continue; }
      let prepared = prepareSalesBackfill(previous, incoming);
      if (prepared.kind === "exception" && prepared.reason.includes("verified report-day FX")) {
        if (!rates.has(previous.day)) rates.set(previous.day, await fetchEurRates(previous.day).catch(() => ({})));
        prepared = prepareSalesBackfill(previous, incoming, rates.get(previous.day));
      }
      if (prepared.kind === "exception") exceptions.push({ appId, day: previous.day, reason: prepared.reason });
      else { counts[prepared.kind] = (counts[prepared.kind] ?? 0) + 1; updates.push(prepared.row); }
    }
    if (updates.length) plan.push({ path: file, rows: updates });
  }
  const latest = [...parsed.keys()].sort().at(-1);
  if (!latest) throw new Error("No valid historical sales reports were available");
  // Seed only the newest confirmed report; do not invent historical rows for apps that were
  // not yet discovered. Existing rows retain their original totals via prepareSalesBackfill.
  if (!rates.has(latest)) rates.set(latest, await fetchEurRates(latest).catch(() => ({})));
  let seeded = 0;
  for (const app of apps) {
    const file = salesPath(app.appId, latest);
    const existing = (snapshot.get(file) as SalesDay[] | undefined)?.find((r) => r.day === latest);
    if (existing) continue;
    const incoming = parsed.get(latest)![app.appId];
    if (!incoming) continue;
    if (incoming.proceedsUsd !== 0 || Object.values(incoming.proceedsByCcy ?? {}).some((n) => n !== 0)) {
      exceptions.push({ appId: app.appId, day: latest, reason: "Unrecorded proceeds require a separate collection before classification" });
      continue;
    }
    convertSalesDayToEur(incoming, rates.get(latest)!);
    let target = plan.find((p) => p.path === file);
    if (!target) { target = { path: file, rows: [] }; plan.push(target); }
    target.rows.push(incoming);
    seeded++;
  }
  const summary = {
    mode: write ? "write" : "dry-run", repository: e.GITHUB_DATA_REPO,
    firstReportDay: dates[0], latestReportDay: latest, reportDates: dates.length,
    validReports: parsed.size, failures, classifiedRows: counts, exceptions,
    latestDaySeededApps: seeded, affectedFiles: plan.length,
  };
  await writeFile(path.join(output, "plan.json"), JSON.stringify(plan, null, 2), { mode: 0o600 });
  await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, exceptions: exceptions.length }));
  if (!write) return;
  // An exceptions file is reviewable; no partial silent migration is allowed.
  if (failures.length || exceptions.length) throw new Error("Backfill has unresolved exceptions; no writes performed");
  let written = 0;
  for (const file of plan) {
    const appId = file.path.split("/")[1];
    await store.upsertDailyArray(file.path, file.rows, "data: classify historical App Store revenue", (previous, incoming) => {
      const raw = parsed.get(incoming.day)?.[appId];
      if (!raw) throw new Error("Backfill source disappeared");
      const prepared = prepareSalesBackfill(previous, raw, rates.get(incoming.day));
      if (prepared.kind === "exception") throw new Error(`Concurrent data change prevented backfill for ${incoming.day}`);
      return prepared.row;
    });
    written++;
    await writeFile(path.join(output, "write-progress.json"), JSON.stringify({ written, total: plan.length, lastFile: file.path }), { mode: 0o600 });
  }
  console.log(JSON.stringify({ writtenFiles: written }));
}
