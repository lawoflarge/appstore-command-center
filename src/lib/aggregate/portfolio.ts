export function attentionScore(i: { anomalyDrop: boolean; ratingDelta: number; unresponded: number }): number {
  return (i.anomalyDrop ? 5 : 0) + (i.ratingDelta < 0 ? Math.abs(i.ratingDelta) * 10 : 0) + Math.min(i.unresponded, 10);
}

export function rankPortfolio<T extends { score: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.score - a.score);
}
