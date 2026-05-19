import { test, expect, vi } from "vitest";
import { makeStore } from "@/lib/store/store";

function fakeGh() {
  const fs = new Map<string, { value: any; sha: string }>();
  let n = 0;
  return {
    fs,
    get: vi.fn(async (p: string) => fs.get(p) ?? null),
    put: vi.fn(async (p: string, v: any, _sha: string | null) => {
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
