# Action Feed + Global Refresh — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

The `/insights` page is a passive, per-app data dump. Every app gets a uniform card — even apps with nothing to act on — showing an anomaly badge, funnel rates, forecast, and keyword chips. It *describes* signal ("downloads anomaly", "funnel leak") but it does not **prioritize** and it does not say **what to do**. Visually everything carries equal weight, so the eye has nothing to land on.

Two asks:
1. **Proactive, not passive (#2):** turn raw signals into a ranked feed of actionable recommendations.
2. **UX polish (#4):** make the important things visually obvious; quiet the noise. Plus: the on-demand Refresh button currently lives only on Glance — it should be on every page.

## Scope

**In scope:** only the existing intelligence signals already produced by the daily run — download anomalies (drop/spike), funnel leaks, keyword moves, forecast. No new collectors, no new stored data, no cron change. Plus moving the Refresh button to global nav.

**Out of scope:** unanswered reviews, rating drops, any new data flow, any LLM use (hard constraint #4 in CLAUDE.md), push/email notifications.

## Architecture

### 1. `buildActionItems` — pure transform (heart of #2)

New module `src/lib/intelligence/actions.ts`:

```ts
buildActionItems(insights: Insights): ActionItem[]
```

- **Input:** the already-stored `Insights` object (read from `insightsPath()` — no new data flow).
- **Output:** a flat list of `ActionItem`, sorted by `score` descending (most urgent first).
- Pure function, no I/O — fully unit-testable.

```ts
type Severity = "critical" | "opportunity" | "good";

interface ActionItem {
  appId: string;
  appName: string;
  kind:
    | "anomaly_drop"
    | "anomaly_spike"
    | "funnel_pvd"
    | "funnel_ipv"
    | "keyword_declining"
    | "keyword_opportunity";
  severity: Severity;
  title: string;          // short headline, e.g. "Downloads dropped sharply"
  detail: string;         // what happened, from the signal (numbers/cause)
  recommendation: string; // what to do (templated)
  score: number;          // for deterministic sort
}
```

One `AppInsight` can yield multiple items (e.g. an anomaly + a funnel leak + several keyword items). Keyword opportunities are emitted per term but capped at the **top 3 per app by score** so one noisy app cannot flood the feed — the cap is a named constant in code.

### 2. Severity model + scoring

Three tiers; each signal type maps to a tier and a numeric `score` for ordering within and across tiers (critical always outranks opportunity outranks good via a tier base offset).

| Signal | Tier | Score basis |
|---|---|---|
| Download **drop** anomaly | `critical` | base 1000 + `abs(z) * 10` |
| Funnel leak `pageView_to_install` | `critical` | base 1000 + dropPct·100 |
| Funnel leak `impression_to_pageView` | `critical` | base 1000 + dropPct·100 (slightly below pvd at equal drop) |
| Keyword **declining** | `opportunity` | base 500 + `(26 - rank)` (closer to top 10 ranks higher) |
| Keyword **improving** (rank 8–25) | `opportunity` | base 400 + `(26 - rank)` |
| Download **spike** anomaly | `good` | base 100 + `abs(z)` |

`dropPct` for funnel comes from `(baselineRate - rate) / baselineRate`, already computable from `FunnelDiagnosis.rates`.

### 3. Recommendation templates (rules-based, no LLM)

A `RECOMMENDATIONS` map: signal kind → templated sentence with interpolated values. Examples:

- **anomaly_drop, near release:** "Downloads dropped sharply right after {version}. Diff that release — a regression or store-listing change is the likely cause."
- **anomaly_drop, no release:** "Downloads dropped with no release nearby. Check App Store availability and look for an external cause (seasonality, lost feature/ASA)."
- **anomaly_spike:** "Downloads spiked. Find what drove it (press, feature, ASA) and double down while it lasts."
- **funnel_pvd:** "People view the page but don't install. Refresh screenshots/icon or address a low rating."
- **funnel_ipv:** "People see you in search/browse but don't tap through. Your icon, title or first screenshot isn't earning the tap."
- **keyword_declining:** "{term} slipped to #{rank} in {country}. Refresh your keyword field / metadata to defend it."
- **keyword_opportunity:** "{term} sits at #{rank} ({country}) and is climbing. Work it into your title/subtitle to push into the top 10."

The release-aware branch reuses `Anomaly.cause` (which already encodes "near the {version} release" vs "no release nearby").

### 4. Forecast — context, not an action

Forecast has no clear action without a prior-month comparison, and pulling the prior month in would be new data flow (out of scope). It stays a **displayed number** (projected ± band) on each app's row in the full feed, but is **not** a ranked action item.

### 5. Surfaces

- **`/insights` rebuilt** → full action feed. Grouped by tier (critical → opportunity → good), sorted by `score` within each. Apps with zero items collapse into a single quiet "All clear — N apps with no signal" row. Forecast shown as context.
- **Glance `/` → "Top 3" block.** Calls the same `buildActionItems`, slices the top 3, renders a compact one-line-per-item list (severity dot + title) with a "View all →" link to `/insights`. If there are zero items, show a calm "All clear" line.
- **Shared component** `src/components/insights/ActionCard.tsx` with a compact variant (Glance) and a full variant (Insights). Glass tokens (`Card`, severity colors `--bad` / `--accent` / `--ok`).

Action card layout (full variant): **What** (title) → **Why** (detail) → **Recommendation**. No deep-link button (kept simple per YAGNI; can be added later).

### 6. Global Refresh button

- Move `<RefreshButton />` into `src/components/glass/Nav.tsx`, right-aligned (`ml-auto` on the button so it sits at the end of the nav row). It then appears on every page (Glance, Portfolio, Revenue, ASO, Reviews, Insights, Settings).
- Remove the standalone `<RefreshButton />` from `src/app/page.tsx` (Glance) to avoid duplication.
- `RefreshButton` itself is unchanged — it calls `router.refresh()`, which re-renders the current route, so it works correctly on any page.
- Keep the button compact (`py-1.5`) so the nav bar does not wrap awkwardly.

## Data flow

Both `/insights` and `/` already read `insightsPath()` from the store. `buildActionItems` runs **compute-on-read** at request time — the same pattern as the existing `src/lib/aggregate/` functions. No cron change, no new collectors, no new stored JSON.

## Testing

Vitest unit tests for `src/lib/intelligence/actions.ts`:
- each signal kind produces the expected `kind`, `severity`, and recommendation
- a drop anomaly outranks a keyword opportunity outranks a spike (tier ordering)
- the keyword per-app cap holds
- the all-clear case (empty `Insights`) returns `[]`

Matches the existing convention (~110 tests, fixtures next to the unit). Chart/page rendering covered by existing jsdom-safe patterns where applicable.

## Constraints honored (from CLAUDE.md)

- No LLM (recommendations are templated). ✓
- No DB / git-as-DB untouched (compute-on-read). ✓
- No new collectors / no cron 60s-cap risk. ✓
- pnpm only, Node 20, strict lint. ✓
- Branch + PR, not direct push to main. ✓
