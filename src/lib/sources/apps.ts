import type { AppMeta } from "@/lib/store/paths";

export type FetchApps = () => Promise<{ id: string; attributes: { name: string; bundleId: string; sku: string } }[]>;

export async function discoverApps(fetchApps: FetchApps, today: string): Promise<AppMeta[]> {
  const rows = await fetchApps();
  return rows.map((r) => ({
    appId: r.id,
    name: r.attributes.name,
    bundleId: r.attributes.bundleId,
    sku: r.attributes.sku,
    firstSeen: today,
    hidden: false,
    archived: false,
    releases: [],
  }));
}

export const ascFetchApps = (key: import("@/lib/asc/jwt").AscKey) =>
  async () => (await import("@/lib/asc/client")).ascGetAllPages(key, "/v1/apps?limit=200");
