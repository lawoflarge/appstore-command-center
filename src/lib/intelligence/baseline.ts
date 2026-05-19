export interface Point { day: string; value: number; }

const utcDow = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();

export function zScore(series: Point[], day: string):
  { z: number; baseline: number; std: number } | null {
  const dow = utcDow(day);
  const prior = series.filter(
    (p) => p.day < day && utcDow(p.day) === dow,
  );
  if (prior.length < 3) return null;
  const cur = series.find((p) => p.day === day);
  if (!cur) return null;
  const mean = prior.reduce((s, p) => s + p.value, 0) / prior.length;
  const variance = prior.reduce((s, p) => s + (p.value - mean) ** 2, 0) / prior.length;
  const std = Math.sqrt(variance) || 1;
  return { z: (cur.value - mean) / std, baseline: mean, std };
}
