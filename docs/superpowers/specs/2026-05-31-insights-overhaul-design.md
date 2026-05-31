# Insights Overhaul — design & spec (2026-05-31)

Autonomous bug-fix + feature pass on the App Store Command Center. Goal: a dashboard
that tracks **all** apps end-to-end (downloads, revenue, impressions, engagement) and
surfaces maximum honest insight from every source already wired (ASC analytics, ASC
sales/finance, AdMob), with a consistent polished glass UI.

Scope decided with the owner: deploy direct to `main` + prod; polish the existing
"Daylight Frost" glass look (no full redesign); add IAP/subscription revenue, a unified
revenue view, and extended funnel insights; no Apple Search Ads; full autonomy on feature
selection.

## Audit findings (verified in browser + data repo on 2026-05-31)

The data repo has real **analytics** rows (downloads, impressions, page views) and **AdMob**
rows, but **sales** is empty for every app and analytics never carries
sessions/activeDevices/deletions/crashes.

1. **Empty downloads charts.** `aggregate/series.ts` `sourceFor("downloads")` returns `"sales"`,
   which is empty for these (free) apps. Glance "Total downloads", app-detail "Downloads",
   and "Activity heatmap" all render blank, while `buildGlance` already (correctly) prefers
   analytics. Fix: route `downloads`/`redownloads` through analytics, keep `proceedsUsd`/
   country breakdown on sales (for when revenue lands).
2. **Broken funnel rate.** `series.ts` `funnelStages` inserts a `Sessions` stage (always 0),
   so the download conversion divides by zero and shows "—". Fix: funnel = Impressions →
   Page views → Downloads with rates pv/imp and dl/pv (matches the correct intelligence funnel).
3. **Insights fed empty inputs.** `orchestrator.ts` builds `intelInputs` with hardcoded
   empty `downloads`/`funnel`/`keywords`, so anomaly/funnel/forecast/keyword-opportunity are
   meaningless and the Insights + ASO pages show nothing useful. Fix: assemble real `AppInput`
   from the freshly collected analytics + keyword data before `runIntelligence`.
4. **App-detail unreachable.** Portfolio and Glance app rows are not links to `/app/<id>`.
   Fix: make app names link through.
5. **Missing engagement metrics.** Analytics collector only fetches "App Downloads Standard"
   and "App Store Discovery and Engagement Standard". Add Sessions / Installation-Deletion /
   Crashes report types (bounded, parallel per report to respect the 60 s cap) to populate
   sessions, activeDevices, deletions, crashes.
6. **Sales requests today.** Cron passes `todayUtc()`; Apple's daily report for today does not
   exist yet. Request a lagged date (day-1, falling back to day-2…day-5 on 404) so proceeds /
   IAP / subscription revenue actually flow.
7. **No empty states.** Charts render blank when a series has no points. Add an honest
   "No data yet" empty state in the chart frame.

## Features

- **IAP / subscription revenue (ASC sales/finance).** Extend the sales collector to keep
  `proceedsUsd` and split units into app downloads vs. in-app purchase / subscription rows
  (product-type identifiers `IA*`, `IAY`, `IAC`, etc.). Stored in the existing append-only
  `sales/<YYYY-MM>.json`.
- **Unified Revenue dashboard.** New aggregation merging AdMob earnings + ASC proceeds into
  total revenue, revenue mix (ads vs. IAP), and per-app / portfolio rollups, surfaced as a
  "Total revenue" section on the Revenue page above the existing AdMob charts.
- **Extended funnel insights.** Use the new engagement metrics for an Impressions → Page
  views → Downloads → Active-devices view, a retention proxy (activeDevices/downloads), and a
  crash-trend signal in Insights.

## Design

Keep the glass tokens; raise consistency to the level of the existing Revenue tab. Add: chart
empty states, a reusable section header, active-nav state, tighter stat cards, hover/focus
microinteractions, and an honest "warming up" copy for day-0 zeros. Verify every page with a
real headless-Chromium screenshot before shipping.

## Constraints honored

pnpm only · Node 20 · 60 s Hobby cap (collectors stay parallel) · zero LLM · secrets
server-side · single-user auth unchanged · git-as-DB append-only · strict lint · Vitest green.

## Verification

`pnpm test` + `pnpm build` green; headless-Chromium screenshots of all pages show populated
charts and no blank/"—" states; merge to `main`; confirm Vercel prod deploy renders live.
