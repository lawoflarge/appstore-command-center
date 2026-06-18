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

// Per-instance read cache for page renders. Pages are force-dynamic and read
// hundreds of small JSON files per render through the GitHub Contents API (one
// request per file). Without caching, every reload re-fetched all of them, so a
// handful of reloads/refreshes exhausted GitHub's 5,000 req/hr limit — reads then
// 403'd and the whole dashboard threw a server-side exception until the rate window
// reset. The data changes only once a day (the cron), so a short TTL is safe.
// Opt-in via `cacheReads` so read-modify-write callers (the config writer, the cron
// collection) keep reading fresh; writes always drop their own path so an in-app
// save or refresh shows new data immediately on a warm instance.
const READ_TTL_MS = 300_000;
const readCache = new Map<string, { value: unknown; at: number }>();

export function makeStore(gh: GhBackend, opts: { cacheReads?: boolean } = {}) {
  async function readRaw<T>(path: string): Promise<{ value: T; sha: string } | null> {
    if (!opts.cacheReads) return gh.get<T>(path);
    const hit = readCache.get(path);
    if (hit && Date.now() - hit.at < READ_TTL_MS) {
      return hit.value as { value: T; sha: string } | null;
    }
    const r = await gh.get<T>(path);
    readCache.set(path, { value: r, at: Date.now() });
    return r;
  }
  return {
    async readJson<T>(path: string, fallback: T): Promise<T> {
      const r = await readRaw<T>(path);
      return r ? r.value : fallback;
    },
    async writeJson(path: string, value: unknown, message: string): Promise<void> {
      await retryOn409(async () => {
        const existing = await gh.get(path);
        await gh.put(path, value, existing?.sha ?? null, message);
      });
      readCache.delete(path);
    },
    /**
     * Merge rows into an array-of-{day} file, replacing same-day entries.
     * Pass `merge` to combine an incoming row with the existing same-day row instead of
     * the default newest-wins replace — used by analytics so a re-fetched 0 (Apple drops
     * aged days out of the rolling window) can't wipe a previously recorded positive.
     */
    async upsertDailyArray<T extends { day: string }>(
      path: string, rows: T[], message: string,
      merge?: (prev: T, incoming: T) => T,
    ): Promise<void> {
      await retryOn409(async () => {
        const existing = await gh.get<T[]>(path);
        const map = new Map<string, T>();
        for (const r of existing?.value ?? []) map.set(r.day, r);
        for (const r of rows) {
          const prev = map.get(r.day);
          map.set(r.day, prev && merge ? merge(prev, r) : r);
        }
        const merged = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
        await gh.put(path, merged, existing?.sha ?? null, message);
      });
      readCache.delete(path);
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
      readCache.delete(path);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
