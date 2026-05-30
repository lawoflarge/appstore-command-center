import { env } from "@/env";
import { ghGetJson, ghPutJson, type GhConfig } from "./github";

export interface GhBackend {
  get<T>(path: string): Promise<{ value: T; sha: string } | null>;
  put(path: string, value: unknown, sha: string | null, message: string): Promise<void>;
}

export function ghBackendFromEnv(): GhBackend {
  const e = env();
  const cfg: GhConfig = {
    repo: e.GITHUB_DATA_REPO, token: e.GITHUB_DATA_TOKEN, branch: e.GITHUB_DATA_BRANCH,
  };
  return {
    get: (p) => ghGetJson(cfg, p),
    put: (p, v, sha, m) => ghPutJson(cfg, p, v, sha, m),
  };
}

// Retry a writer that follows the read-modify-put pattern, re-reading on 409
// (sha conflict) so two concurrent writers to the same file converge instead of
// one losing. Per-app paths shouldn't collide, but shared files
// (insights, run-status) do — and parallel writers can race even on disjoint
// paths if GitHub returns a stale sha.
const MAX_RETRIES = 5;
async function retryOn409<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!msg.includes(" 409 ") || attempt >= MAX_RETRIES) throw e;
      // Backoff: 50ms, 100ms, 200ms, 400ms, 800ms with small jitter
      const base = 50 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, base + Math.random() * 50));
    }
  }
}

export function makeStore(gh: GhBackend) {
  return {
    async readJson<T>(path: string, fallback: T): Promise<T> {
      const r = await gh.get<T>(path);
      return r ? r.value : fallback;
    },
    async writeJson(path: string, value: unknown, message: string): Promise<void> {
      await retryOn409(async () => {
        const existing = await gh.get(path);
        await gh.put(path, value, existing?.sha ?? null, message);
      });
    },
    /** Merge rows into an array-of-{day} file, replacing same-day entries. */
    async upsertDailyArray<T extends { day: string }>(
      path: string, rows: T[], message: string,
    ): Promise<void> {
      await retryOn409(async () => {
        const existing = await gh.get<T[]>(path);
        const map = new Map<string, T>();
        for (const r of existing?.value ?? []) map.set(r.day, r);
        for (const r of rows) map.set(r.day, r);
        const merged = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
        await gh.put(path, merged, existing?.sha ?? null, message);
      });
    },
    /** Merge rows into an array file keyed by a composite key, replacing dupes. */
    async upsertKeyedArray<T>(
      path: string, rows: T[], keyOf: (r: T) => string, message: string,
    ): Promise<void> {
      await retryOn409(async () => {
        const existing = await gh.get<T[]>(path);
        const map = new Map<string, T>();
        for (const r of existing?.value ?? []) map.set(keyOf(r), r);
        for (const r of rows) map.set(keyOf(r), r);
        const merged = [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
        await gh.put(path, merged, existing?.sha ?? null, message);
      });
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
