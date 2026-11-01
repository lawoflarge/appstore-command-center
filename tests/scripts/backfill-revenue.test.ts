import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SalesDay } from "@/lib/store/paths";

// The revenue backfill is a write path too: it must neither enrich nor seed a transferred app's
// days before its countFrom (lib/countFrom.ts). Apple IO and the data repo are replaced by an
// in-memory snapshot; the script runs for real in dry-run mode and its plan is inspected.
const { snapshot } = vi.hoisted(() => ({ snapshot: new Map<string, unknown>() }));
vi.mock("@/env", () => ({ env: () => ({ GITHUB_DATA_REPO: "owner/data", ASC_VENDOR_NUMBER: "vendor" }) }));
vi.mock("@/lib/asc/jwt", () => ({ ascKeyFromEnv: () => ({}) }));
vi.mock("@/lib/fx", () => ({ fetchEurRates: async () => ({}) }));
vi.mock("@/lib/store/store", () => ({
  ghBackendFromEnv: () => ({ snapshot: async () => snapshot }),
  makeStore: () => ({ upsertDailyArray: vi.fn() }),
}));
vi.mock("@/lib/sources/sales", () => ({
  ascFetchSalesTsv: () => async (day: string) => [{ day }],
  // Every report day carries a zero-proceeds row for every app, like Apple's account report.
  parseSalesRows: (_rows: unknown, apps: { appId: string }[], day: string) => Object.fromEntries(apps.map((a) => [a.appId, zero(day)])),
  convertSalesDayToEur: (row: SalesDay) => { row.proceedsEur = 0; },
}));
vi.mock("@/lib/sources/revenueBackfill", () => ({
  prepareSalesBackfill: (previous: SalesDay) => ({ kind: "zero", row: { ...previous, reportAvailable: true } }),
}));

// scripts/backfill-revenue.mjs (the runner) shares the basename and Vite resolves the bare path to
// it, so load the .ts module by its file path; the type comes from the extensionless specifier.
type Backfill = typeof import("../../scripts/backfill-revenue");
let runBackfill: Backfill["runBackfill"];
beforeAll(async () => {
  ({ runBackfill } = await import(/* @vite-ignore */ path.resolve(__dirname, "../../scripts/backfill-revenue.ts")) as Backfill);
});

function zero(day: string): SalesDay {
  return { day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: 0, proceedsByCcy: {} };
}
const meta = (appId: string) => ({ appId, name: appId, bundleId: appId, sku: `S${appId}`, firstSeen: "2026-10-01", hidden: false, archived: false, releases: [] });

let out = "";
beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), "backfill-test-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  snapshot.clear();
  snapshot.set("data/100/meta.json", meta("100"));
  snapshot.set("data/200/meta.json", meta("200"));
  snapshot.set("data/100/sales/2026-10.json", [zero("2026-10-29"), zero("2026-10-30")]);
  // A pre-cutoff row of the transferred app that is sitting in the data repo anyway.
  snapshot.set("data/200/sales/2026-10.json", [zero("2026-10-29")]);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(out, { recursive: true, force: true }); });

it("never enriches or seeds a transferred app's days before its countFrom", async () => {
  snapshot.set("data/config.json", { apps: { "200": { hidden: false, archived: false, keywords: [], countFrom: "2026-10-31" } } });
  await runBackfill([`--output=${out}`]);
  const plan = JSON.parse(await readFile(path.join(out, "plan.json"), "utf8"));
  const summary = JSON.parse(await readFile(path.join(out, "summary.json"), "utf8"));
  expect(plan.map((f: { path: string; rows: SalesDay[] }) => [f.path, f.rows.map((r) => r.day)])).toEqual([
    ["data/100/sales/2026-10.json", ["2026-10-29", "2026-10-30"]],
  ]);
  expect(summary).toMatchObject({ latestReportDay: "2026-10-30", latestDaySeededApps: 0, exceptions: [] });
});

it("without a countFrom the same snapshot enriches and seeds the app as before", async () => {
  await runBackfill([`--output=${out}`]);
  const plan = JSON.parse(await readFile(path.join(out, "plan.json"), "utf8"));
  expect(plan.map((f: { path: string; rows: SalesDay[] }) => [f.path, f.rows.map((r) => r.day)])).toEqual([
    ["data/100/sales/2026-10.json", ["2026-10-29", "2026-10-30"]],
    ["data/200/sales/2026-10.json", ["2026-10-29", "2026-10-30"]],
  ]);
});

it("stops on an invalid countFrom before reading any report", async () => {
  snapshot.set("data/config.json", { apps: { "200": { hidden: false, archived: false, keywords: [], countFrom: "2026-10-1" } } });
  await expect(runBackfill([`--output=${out}`])).rejects.toThrow(/countFrom/);
});
