import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscriptions: vi.fn(), admob: vi.fn(), daily: vi.fn(), discover: vi.fn(),
  store: { readJson: vi.fn(), upsertKeyedArray: vi.fn(), writeJson: vi.fn() },
}));
vi.mock("@/env", () => ({ env: () => ({ ASC_VENDOR_NUMBER: "sample-vendor" }) }));
vi.mock("@/lib/asc/jwt", () => ({ ascKeyFromEnv: () => ({}), signAscToken: () => "sample-token" }));
vi.mock("@/lib/store/store", () => ({ makeStore: () => mocks.store, ghBackendFromEnv: () => ({}) }));
vi.mock("@/lib/orchestrator", () => ({ runDailyCollection: mocks.daily }));
vi.mock("@/lib/sources/apps", () => ({ discoverApps: mocks.discover, ascFetchApps: () => vi.fn() }));
vi.mock("@/lib/sources/admob", () => ({ admobConfigured: () => true, collectAdmobReport: mocks.admob }));
vi.mock("@/lib/sources/subscriptions", () => ({ ascFetchSubscriptionsTsv: () => vi.fn(), collectSubscriptionsInto: mocks.subscriptions }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.readJson.mockResolvedValue({ apps: {} });
  mocks.store.upsertKeyedArray.mockResolvedValue(undefined);
  mocks.store.writeJson.mockResolvedValue(undefined);
  mocks.admob.mockResolvedValue({ rows: [], coverage: { startDay: "2026-07-10", endDay: "2026-10-10", completeThroughDay: "2026-10-09", reportingTimeZone: "Europe/Berlin", currencyCode: "EUR", collectedAt: "2026-10-10T12:00:00Z" } });
  mocks.discover.mockResolvedValue([{ appId: "100" }, { appId: "200" }]);
  mocks.daily.mockResolvedValue({ lastRun: "2026-10-10T12:00:00Z", lastSuccess: "", perApp: {} });
  mocks.subscriptions.mockResolvedValue({ ok: true, reportDate: "2026-10-09", products: 1 });
});

it("collects subscription stock once at refresh start, never for its per-app batches or finish", async () => {
  const { runRefreshStart, runCollectBatch, runFinish } = await import("@/lib/runCollection");
  const start = await runRefreshStart();
  await runCollectBatch(["100"]);
  await runCollectBatch(["200"]);
  await runFinish();
  expect(start.appIds).toEqual(["100", "200"]);
  expect(start.subscriptions).toMatchObject({ ok: true, reportDate: "2026-10-09" });
  expect(mocks.subscriptions).toHaveBeenCalledTimes(1);
  expect(mocks.admob).toHaveBeenCalledTimes(1);
});

it("starts subscriptions and per-app work while account-wide AdMob is still pending", async () => {
  let releaseAdmob!: (report: { rows: never[]; coverage: unknown }) => void;
  mocks.admob.mockReturnValue(new Promise((resolve) => { releaseAdmob = resolve; }));
  const { runCronBatch } = await import("@/lib/runCollection");
  const pending = runCronBatch(["100"]);
  await vi.waitFor(() => {
    expect(mocks.subscriptions).toHaveBeenCalledTimes(1);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });
  releaseAdmob({ rows: [], coverage: {} });
  expect((await pending).subscriptions.ok).toBe(true);
});

const cfgWith = (countFrom: string) => ({ apps: { "200": { hidden: false, archived: false, keywords: [], countFrom } } });

it("passes the configured countFrom to the subscription stock collector on every entry point", async () => {
  mocks.store.readJson.mockImplementation(async (p: string, fb: unknown) => (p === "data/config.json" ? cfgWith("2026-11-01") : fb));
  const { runRefreshStart, runCronBatch, runFullCollection } = await import("@/lib/runCollection");
  await runRefreshStart();
  await runCronBatch(["100"]);
  await runFullCollection();
  expect(mocks.subscriptions).toHaveBeenCalledTimes(3);
  for (const call of mocks.subscriptions.mock.calls) expect(call[3]).toEqual({ countFrom: { "200": "2026-11-01" } });
});

it("an invalid countFrom stops every entry point before any collector starts", async () => {
  mocks.store.readJson.mockImplementation(async (p: string, fb: unknown) => (p === "data/config.json" ? cfgWith("2026-11-1") : fb));
  const { runRefreshStart, runCronBatch, runFullCollection } = await import("@/lib/runCollection");
  for (const run of [() => runRefreshStart(), () => runCronBatch(["100"]), () => runFullCollection()]) {
    await expect(run()).rejects.toThrow(/apps\.200\.countFrom/);
  }
  expect(mocks.subscriptions).not.toHaveBeenCalled();
  expect(mocks.admob).not.toHaveBeenCalled();
  expect(mocks.daily).not.toHaveBeenCalled();
  expect(mocks.discover).not.toHaveBeenCalled();
});

it("does not publish AdMob coverage when a preceding row write fails", async () => {
  mocks.admob.mockResolvedValue({ rows: [{ day: "2026-10-08", appId: "100", adUnit: "unit" }], coverage: {} });
  mocks.store.upsertKeyedArray.mockRejectedValue(new Error("write failed"));
  const { runRefreshStart } = await import("@/lib/runCollection");
  expect((await runRefreshStart()).admob.ok).toBe(false);
  expect(mocks.store.writeJson).not.toHaveBeenCalled();
});
