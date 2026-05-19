import type { Review } from "@/lib/store/paths";

export function mapReviews(rows: any[]): Review[] {
  return rows.map((r) => ({
    id: r.id,
    rating: r.attributes.rating,
    title: r.attributes.title ?? "",
    body: r.attributes.body ?? "",
    reviewer: r.attributes.reviewerNickname ?? "",
    territory: r.attributes.territory ?? "",
    createdDate: r.attributes.createdDate,
    responded: Boolean(r.relationships?.response?.data),
  }));
}

export function mergeReviews(existing: Review[], incoming: Review[]): Review[] {
  const map = new Map<string, Review>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return [...map.values()].sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

export const ascFetchReviews = (key: import("@/lib/asc/jwt").AscKey, appId: string) =>
  async () => (await import("@/lib/asc/client")).ascGetAllPages(
    key, `/v1/apps/${appId}/customerReviews?sort=-createdDate&limit=200&include=response`);
