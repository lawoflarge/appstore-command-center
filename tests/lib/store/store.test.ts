import { test, expect, vi } from "vitest";
import { makeStore } from "@/lib/store/store";

function fakeGh() {
  const fs = new Map<string, { value: any; sha: string }>();
  let n = 0;
  return {
    fs,
    get: vi.fn(async (p: string) => fs.get(p) ?? null),
    put: vi.fn(async (p: string, v: any, _sha: string | null, _msg: string) => {
      fs.set(p, { value: v, sha: "sha" + ++n });
    }),
  };
}

test("upsertDailyArray merges by day idempotently", async () => {
  const gh = fakeGh();
  const store = makeStore(gh as any);
  await store.upsertDailyArray("data/a/sales/2026-05.json",
    [{ day: "2026-05-18", total: 5 }], "m");
  await store.upsertDailyArray("data/a/sales/2026-05.json",
    [{ day: "2026-05-18", total: 9 }, { day: "2026-05-19", total: 2 }], "m");
  const stored = gh.fs.get("data/a/sales/2026-05.json")!.value;
  expect(stored).toEqual([
    { day: "2026-05-18", total: 9 },
    { day: "2026-05-19", total: 2 },
  ]);
});

test("readJson returns fallback when absent", async () => {
  const store = makeStore(fakeGh() as any);
  expect(await store.readJson("missing.json", { x: 1 })).toEqual({ x: 1 });
});

test("writeJson passes null sha on create then the existing sha on update", async () => {
  const gh = fakeGh();
  const store = makeStore(gh as any);
  await store.writeJson("data/c.json", { a: 1 }, "create");
  expect(gh.put.mock.calls[0][2]).toBeNull();
  await store.writeJson("data/c.json", { a: 2 }, "update");
  expect(gh.put.mock.calls[1][2]).toBe("sha1");
  expect(gh.fs.get("data/c.json")!.value).toEqual({ a: 2 });
});

// --- Snapshot reads -----------------------------------------------------------
// A page render used to bill one Contents-API request per file (~700 for the glance
// page), which exhausted GitHub's hourly quota after a handful of reloads and threw.
// Read-heavy stores now take one tarball instead.

function fakeGhWithSnapshot(files: Record<string, unknown>) {
  const gh = fakeGh();
  return Object.assign(gh, {
    snapshot: vi.fn(async () => new Map(Object.entries(files))),
  });
}

test("cacheReads serves every read from a single snapshot", async () => {
  const gh = fakeGhWithSnapshot({
    "data/run-status.json": { perApp: { a: {} } },
    "data/a/meta.json": { name: "App A" },
    "data/a/sales/2026-08.json": [{ day: "2026-08-01", total: 3 }],
  });
  const store = makeStore(gh as any, { cacheReads: true });
  expect(await store.readJson("data/run-status.json", null)).toEqual({ perApp: { a: {} } });
  expect(await store.readJson("data/a/meta.json", null)).toEqual({ name: "App A" });
  expect(await store.readJson("data/a/sales/2026-08.json", [])).toEqual([{ day: "2026-08-01", total: 3 }]);
  expect(gh.snapshot).toHaveBeenCalledTimes(1);
  expect(gh.get).not.toHaveBeenCalled(); // zero per-file requests
});

test("cacheReads takes one snapshot even under a parallel fan-out", async () => {
  // buildGlance/loadRawBundle fire their reads through Promise.all; a snapshot loaded
  // per call rather than memoised as a promise would download the tarball hundreds of times.
  const gh = fakeGhWithSnapshot({ "data/x.json": { v: 1 } });
  const store = makeStore(gh as any, { cacheReads: true });
  await Promise.all(Array.from({ length: 50 }, () => store.readJson("data/x.json", null)));
  expect(gh.snapshot).toHaveBeenCalledTimes(1);
});

test("a path absent from the snapshot yields the fallback without a per-file request", async () => {
  const gh = fakeGhWithSnapshot({ "data/x.json": { v: 1 } });
  const store = makeStore(gh as any, { cacheReads: true });
  expect(await store.readJson("data/a/keywords/2026-05.json", [])).toEqual([]);
  expect(gh.get).not.toHaveBeenCalled();
});

test("a failing snapshot falls back to per-file reads", async () => {
  const gh = fakeGh();
  gh.fs.set("data/x.json", { value: { v: 1 }, sha: "s" });
  const withSnap = Object.assign(gh, {
    snapshot: vi.fn(async () => { throw new Error("GH TARBALL 500: boom"); }),
  });
  const store = makeStore(withSnap as any, { cacheReads: true });
  expect(await store.readJson("data/x.json", null)).toEqual({ v: 1 });
  expect(gh.get).toHaveBeenCalledWith("data/x.json");
});

test("writers do not take a snapshot — they must read the live sha", async () => {
  const gh = fakeGhWithSnapshot({ "data/c.json": { a: 1 } });
  const store = makeStore(gh as any); // no cacheReads: the cron and config writers
  await store.readJson("data/c.json", null);
  expect(gh.snapshot).not.toHaveBeenCalled();
  expect(gh.get).toHaveBeenCalledWith("data/c.json");
});

test("a write drops the snapshot so the next read sees the new value", async () => {
  const gh = fakeGhWithSnapshot({ "data/c.json": { a: 1 } });
  const store = makeStore(gh as any, { cacheReads: true });
  expect(await store.readJson("data/c.json", null)).toEqual({ a: 1 });
  await store.writeJson("data/c.json", { a: 2 }, "update");
  await store.readJson("data/c.json", null);
  expect(gh.snapshot).toHaveBeenCalledTimes(2); // re-taken after the write
});
