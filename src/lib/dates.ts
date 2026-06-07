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

/**
 * Keep only the rows that belong in `monthStart`'s month (YYYY-MM). Use when flattening
 * partitioned month files: Apple's rolling analytics window can spill a previous month's days into
 * the current month file, so the same day would otherwise appear in two files and be double-counted
 * (funnel/breakdowns) or resolve to a stale value (last-write-wins). Filtering each file to its own
 * month makes every day canonical to exactly one file.
 */
export function rowsInMonth<T extends { day: string }>(rows: T[], monthStart: string): T[] {
  const m = monthStart.slice(0, 7);
  return rows.filter((r) => r.day.slice(0, 7) === m);
}
