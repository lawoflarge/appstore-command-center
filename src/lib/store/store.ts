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

export function makeStore(gh: GhBackend) {
  return {
    async readJson<T>(path: string, fallback: T): Promise<T> {
      const r = await gh.get<T>(path);
      return r ? r.value : fallback;
    },
    async writeJson(path: string, value: unknown, message: string): Promise<void> {
      const existing = await gh.get(path);
      await gh.put(path, value, existing?.sha ?? null, message);
    },
    /** Merge rows into an array-of-{day} file, replacing same-day entries. */
    async upsertDailyArray<T extends { day: string }>(
      path: string, rows: T[], message: string,
    ): Promise<void> {
      const existing = await gh.get<T[]>(path);
      const map = new Map<string, T>();
      for (const r of existing?.value ?? []) map.set(r.day, r);
      for (const r of rows) map.set(r.day, r);
      const merged = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
      await gh.put(path, merged, existing?.sha ?? null, message);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
