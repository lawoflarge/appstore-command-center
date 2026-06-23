// src/lib/dashboards/migrate.ts
import type { ChartCard, DashboardSlice, Metric } from "./types";

// Apple only emits Sessions / Active-devices / Deletions / Crashes analytics instances above a
// usage threshold these low-volume apps never reach, so those AnalyticsDay fields are 0 forever
// (verified live; see CLAUDE.md "Session / active-device / crash analytics are NOT collected").
// A saved chart bound to one of these renders a permanently flat, empty graph — exactly the dead
// "Active devices" card the glance dashboard persisted before the default was fixed. These are
// excluded from the CardEditor's metric picker, and any already-saved card using one is migrated
// to `downloads` (the core metric every app has) on read, so old dashboards self-heal instead of
// showing a dead chart.
export const DEAD_METRICS: ReadonlySet<Metric> = new Set<Metric>([
  "sessions", "activeDevices", "deletions", "crashes",
]);

const DEAD_TITLE = /active devices|sessions|deletions|crashes/i;

function migrateCard(card: ChartCard): ChartCard {
  if (!DEAD_METRICS.has(card.metric)) return card;
  return {
    ...card,
    metric: "downloads",
    // Only rewrite a title that named the dead metric; a user-renamed title is left alone.
    title: DEAD_TITLE.test(card.title) ? "Downloads" : card.title,
  };
}

// Returns the same slice reference when nothing changed, so callers can cheaply tell whether a
// persisted file is already clean.
export function migrateSlice(slice: DashboardSlice): DashboardSlice {
  let changed = false;
  const cards = slice.cards.map((c) => {
    const next = migrateCard(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...slice, cards } : slice;
}
