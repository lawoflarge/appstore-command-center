import type { KeywordRank } from "@/lib/store/paths";

export interface Opportunity {
  term: string; country: string; rank: number;
  trend: "improving" | "declining" | "flat";
}

export function keywordOpportunities(hist: KeywordRank[], day: string): Opportunity[] {
  const today = hist.filter((h) => h.day === day && h.rank != null && h.rank >= 8 && h.rank <= 25);
  return today
    .map((t) => {
      const prev = hist
        .filter((h) => h.term === t.term && h.country === t.country && h.day < day && h.rank != null)
        .sort((a, b) => b.day.localeCompare(a.day))[0];
      let trend: Opportunity["trend"] = "flat";
      if (prev && prev.rank != null) {
        if (t.rank! < prev.rank - 1) trend = "improving";
        else if (t.rank! > prev.rank + 1) trend = "declining";
      }
      return { term: t.term, country: t.country, rank: t.rank!, trend };
    })
    .sort((a, b) => a.rank - b.rank);
}
