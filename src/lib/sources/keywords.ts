import type { KeywordRank } from "@/lib/store/paths";

export async function collectKeywordRanks(
  appId: string, watch: { term: string; country: string }[], day: string,
): Promise<KeywordRank[]> {
  const out: KeywordRank[] = [];
  for (const w of watch) {
    const q = new URLSearchParams({
      term: w.term, country: w.country, entity: "software", limit: "200",
    });
    const res = await fetch(`https://itunes.apple.com/search?${q}`, { cache: "no-store" });
    let rank: number | null = null;
    if (res.ok) {
      const j = (await res.json()) as { results: { trackId: number }[] };
      const idx = j.results.findIndex((r) => String(r.trackId) === appId);
      rank = idx >= 0 ? idx + 1 : null;
    }
    out.push({ day, term: w.term, country: w.country, rank });
  }
  return out;
}
