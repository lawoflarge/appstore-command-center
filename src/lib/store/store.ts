import { env } from "@/env";
import { ghGetJson, ghPutJson, ghGetSnapshot, type GhConfig } from "./github";

export interface GhBackend {
  get<T>(path: string): Promise<{ value: T; sha: string } | null>;
  put(path: string, value: unknown, sha: string | null, message: string): Promise<void>;
  /** Every JSON file in the repo in one request. Absent backends fall back to per-file gets. */
  snapshot?(): Promise<Map<string, unknown>>;
}

export function ghBackendFromEnv(): GhBackend {
  const e = env();
  const cfg: GhConfig = {
    repo: e.GITHUB_DATA_REPO, token: e.GITHUB_DATA_TOKEN, branch: e.GITHUB_DATA_BRANCH,
  };
  return {
    get: (p) => ghGetJson(cfg, p),
    put: (p, v, sha, m) => ghPutJson(cfg, p, v, sha, m),
    snapshot: () => ghGetSnapshot(cfg),
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

// Fallback read cache, used only when the snapshot below is unavailable. Pages are
// force-dynamic and read hundreds of small JSON files per render through the GitHub
// Contents API (one request per file), so without either mechanism a handful of reloads
// exhausted GitHub's 5,000 req/hr limit — reads then 403'd and the whole dashboard threw
// a server-side exception until the rate window reset.
const READ_TTL_MS = 300_000;
const readCache = new Map<string, { value: unknown; at: number }>();

export function makeStore(gh: GhBackend, opts: { cacheReads?: boolean } = {}) {
  // One tarball carries every JSON file in the repo, and GitHub serves it via codeload,
  // which bills no API quota — so a whole render costs zero of the hourly budget instead
  // of ~700 requests. It is deliberately scoped to this store (one render) rather than
  // shared across renders: there is no quota reason to hold it, and a per-render snapshot
  // means every page sees the current commit and an in-app save shows up immediately.
  // Memoised as the *promise* so a parallel fan-out of reads still takes only one.
  let snapshot: Promise<Map<string, unknown> | null> | null = null;
  function loadSnapshot(): Promise<Map<string, unknown> | null> {
    if (!gh.snapshot) return Promise.resolve(null);
    snapshot ??= gh.snapshot().catch((e: unknown) => {
      // Falling back to per-file reads keeps the page alive, but it is the expensive path
      // and the reason a quota outage would recur — say so in the runtime logs.
      console.error("snapshot unavailable, falling back to per-file reads:", e);
      return null;
    });
    return snapshot;
  }

  async function readRaw<T>(path: string): Promise<{ value: T; sha: string } | null> {
    if (!opts.cacheReads) return gh.get<T>(path);
    const snap = await loadSnapshot();
    if (snap) {
      const hit = snap.get(path);
      // sha is only consumed by the read-modify-write callers, and those never set
      // cacheReads — they re-read through gh.get to get a live sha.
      return hit === undefined ? null : { value: hit as T, sha: "" };
    }
    const hit = readCache.get(path);
    if (hit && Date.now() - hit.at < READ_TTL_MS) {
      return hit.value as { value: T; sha: string } | null;
    }
    const r = await gh.get<T>(path);
    readCache.set(path, { value: r, at: Date.now() });
    return r;
  }
  // A write invalidates both caches so a later read on this store sees the new value.
  function dropCaches(path: string) {
    readCache.delete(path);
    snapshot = null;
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
      dropCaches(path);
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
      dropCaches(path);
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
      dropCaches(path);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
