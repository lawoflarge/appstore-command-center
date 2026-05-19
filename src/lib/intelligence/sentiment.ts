import type { Review } from "@/lib/store/paths";

export interface Theme { label: string; count: number; sentiment: "positive" | "negative" | "mixed"; exampleIds: string[]; }
export interface ClusterResult { themes: Theme[]; }

const SYS = `You cluster App Store reviews into 3-6 actionable themes.
Return ONLY JSON: {"themes":[{"label","count","sentiment":"positive|negative|mixed","exampleIds":[reviewId,...]}]}.`;

export async function clusterReviews(
  llm: { complete: (s: string, u: string) => Promise<string> },
  newReviews: Review[],
): Promise<ClusterResult> {
  if (newReviews.length === 0) return { themes: [] };
  const user = JSON.stringify(
    newReviews.map((r) => ({ id: r.id, rating: r.rating, text: `${r.title} ${r.body}` })),
  );
  const raw = await llm.complete(SYS, user);
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { themes: parsed.themes ?? [] };
  } catch {
    return { themes: [] };
  }
}
