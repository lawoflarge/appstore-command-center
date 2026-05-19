export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

export function todayUtc(): string {
  return ymd(new Date());
}
