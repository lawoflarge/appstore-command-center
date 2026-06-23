// Split work into bounded slices so a single Vercel Hobby invocation (60s cap) never tries
// to collect the whole portfolio at once — the cause of the chronic FUNCTION_INVOCATION_TIMEOUT
// on /api/cron and /api/refresh. The refresh button drives `chunk`ed batches from the client;
// the once-a-cron path walks a rotating `selectRoundRobinBatch` so every app is refreshed over
// the course of a day without any single run exceeding the time budget.

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Deterministically pick one slice of `appIds` for a given run. `runIndex` advances with
// wall-clock time (e.g. one step per 6h cron tick), so consecutive runs cover different apps
// and the whole list is swept every ceil(n / batchSize) runs. Sorted first so the rotation is
// stable regardless of discovery order.
export function selectRoundRobinBatch(
  appIds: string[], batchSize: number, runIndex: number,
): string[] {
  if (appIds.length === 0 || batchSize <= 0) return [];
  const sorted = [...appIds].sort();
  const numBatches = Math.ceil(sorted.length / batchSize);
  const idx = ((Math.trunc(runIndex) % numBatches) + numBatches) % numBatches;
  return sorted.slice(idx * batchSize, idx * batchSize + batchSize);
}
