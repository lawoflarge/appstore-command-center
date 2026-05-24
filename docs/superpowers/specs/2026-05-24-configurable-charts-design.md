# Configurable Charts on Glance + Per-App — Design Spec

- **Date:** 2026-05-24
- **Owner:** the operator
- **Status:** Approved (brainstorm) → pending implementation plan
- **Project dir:** `~/Data/Claude/appstore-command-center`
- **Parent spec:** [`2026-05-19-appstore-command-center-design.md`](./2026-05-19-appstore-command-center-design.md)

## 1. Purpose

Today the site has exactly one chart — a single downloads area chart on the
per-app page. The rest of the surfaces are KPI tiles and tables. The
collectors already gather rich daily series (impressions, page views, sessions,
active devices, deletions, crashes, by-source, by-country, ratings, keyword
rank), but none of it is visible as a time series.

This spec adds **interactive, user-configurable charts on the Glance
(`/`) and per-app (`/app/[appId]`) surfaces**, configured live on the
deployed Vercel site (not in code), persisted to the existing git-as-DB.

## 2. Goals & success criteria

1. From the live site, the operator can add, edit, reorder, and delete chart
   cards on both Glance and per-app dashboards. Configuration persists across
   sessions and devices.
2. At least seven visualization types are available: area, multi-line,
   stacked area, bar, funnel, small-multiples grid, and calendar heatmap.
3. All ASC-collected metrics are charteable — sales, analytics, ratings,
   reviews, keyword rank — plus two derived conversion metrics.
4. Cross-app comparison works on the Glance dashboard (e.g. one line per app
   for "downloads — last 30 days").
5. Zero new infrastructure: no DB, no external services, no LLM. Persistence
   uses the existing GitHub Contents API write layer. Reads remain
   compute-on-read from per-month JSON.
6. All seven existing hard constraints from the parent spec hold: pnpm only,
   Node 20, Vercel Hobby 60s cap, no LLM, secrets server-side, single-user
   auth, daily refresh only.

## 3. Decisions locked in brainstorm

| Topic | Decision |
|---|---|
| Surfaces | Glance home + per-app page both get configurable dashboards |
| Persistence | git-as-DB — new `data/dashboards.json` in the data repo |
| Config model | One `ChartCard` shape drives every viz |
| Editor UX | Inline range/compare on each card; slide-over panel for structural changes |
| Out of scope | Drag-reorder (use ↑/↓), sharing, LLM suggestions, PNG/CSV export, theme picker, real-time refresh |

## 4. Non-goals (v1, deliberately cut)

- Drag-and-drop card reordering — keyboard/button reorder only.
- Public or cross-tenant chart sharing.
- LLM-generated chart suggestions (parent-spec constraint).
- PNG/CSV export — deferred.
- Real-time / intraday refresh — data is daily.
- A theme picker — Daylight Frost only.
- Mobile-specific layouts beyond what Tailwind responsive utilities already give.

## 5. Data model

### 5.1 `ChartCard` (the unit of configuration)

```ts
export type Metric =
  // sales
  | "downloads" | "redownloads" | "proceedsUsd"
  // analytics
  | "impressions" | "pageViews" | "sessions"
  | "activeDevices" | "deletions" | "crashes"
  // derived
  | "convPageToInstall"       // downloads / pageViews
  | "convImpressionToPage"    // pageViews / impressions
  // ratings
  | "avgRating" | "ratingsCount"
  // reviews
  | "reviewCount" | "responseRate"
  // keywords
  | "keywordRank";            // requires keywordTerm

export type Viz =
  | "area"            // single series
  | "multiLine"       // one line per breakdown bucket (often per app)
  | "stackedArea"     // metric split by breakdown
  | "bar"             // daily bars — good for sparse / proceeds
  | "funnel"          // horizontal funnel: impressions→pageViews→sessions→downloads
  | "smallMultiples"  // grid of mini-sparklines, one per app
  | "heatmap";        // calendar (weekday × week)

export type Range = "7d" | "30d" | "90d" | "mtd" | "ytd" | "all";
export type Bucket = "day" | "week" | "month";
export type Breakdown = "none" | "country" | "source" | "app";

export interface ChartCard {
  id: string;                     // uuid v4
  title: string;
  metric: Metric;
  viz: Viz;
  appIds: "all" | string[];       // per-app dashboard always coerces to [that one]
  range: Range;
  bucket: Bucket;
  breakdown: Breakdown;           // "none" if not used
  compare: "none" | "prevPeriod"; // dashed ghost overlay
  keywordTerm?: string;           // only when metric=keywordRank
}
```

### 5.2 Persistence file (data repo)

```ts
export interface DashboardsFile {
  byId: Record<string, { cards: ChartCard[]; updatedAt: string }>;
  // keys: "glance"   |   "app:<appId>"
}
```

Path: `data/dashboards.json` (same git-as-DB pattern as `config.json`,
`insights.json`, `run-status.json`). Reads through `makeStore(...)`. Writes
through the existing retry-on-409 backoff in `src/lib/store/github.ts` — no
new write paths. `updatedAt` is an ISO 8601 UTC string, matching
`RunStatus.lastRun` and `Review.createdDate` convention.

### 5.3 Metric × Viz compatibility matrix

Editor only enables compatible combinations. Encoded as a small lookup in
`src/lib/aggregate/series.ts`.

| Metric class | area | multiLine | stackedArea | bar | funnel | smallMultiples | heatmap |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Sales (downloads, redownloads, proceedsUsd) | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| Analytics counts (impressions, pageViews, sessions, activeDevices, deletions, crashes) | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| Funnel set (impressions, pageViews, sessions, downloads, summed across apps) | – | – | – | – | ✓ | – | – |
| Derived conversion (convPageToInstall, convImpressionToPage) | ✓ | ✓ | – | – | – | ✓ | – |
| Ratings (avgRating, ratingsCount) | ✓ | ✓ | – | – | – | ✓ | – |
| Reviews (reviewCount, responseRate) | ✓ | ✓ | – | ✓ | – | ✓ | – |
| Keyword rank (per term) | ✓ | ✓ | – | – | – | – | – |

Breakdown compatibility:
- `country` → metrics with `byCountry` raw data (sales, ratings)
- `source` → analytics metrics with `bySource` raw data
- `app` → any metric on Glance with `appIds = "all"` or multiple apps

## 6. Architecture

Three isolated units. Each has one purpose, a defined interface, and is
independently testable.

### 6.1 `series-builder` (pure)

`src/lib/aggregate/series.ts`

```ts
buildSeries(card: ChartCard, raw: RawBundle): SeriesData
```

- **Input** `raw`: a `RawBundle` containing the monthly JSON files needed for
  the card's `appIds × metric × range`. Loaded by the page; passed in.
- **Output** `SeriesData`: shape depends on `viz`:
  - `area | bar | heatmap`: `{ kind, points: { day; value }[], compare?: Point[] }`
  - `multiLine | stackedArea | smallMultiples`: `{ kind, series: { key; label; points: Point[] }[] }`
  - `funnel`: `{ kind, stages: { label; value; rate?: number }[] }`
- Pure, no I/O. All bucketing, range-windowing, breakdown grouping, derived
  metric computation, and previous-period comparison live here.
- Unit-tested with fixtures co-located in `tests/aggregate/series.test.ts`.

### 6.2 `viz/*` components (dumb client)

`src/components/charts/viz/`

| File | Purpose |
|---|---|
| `Area.tsx` | Migrates `LineArea.tsx`; adds optional dashed `compare` overlay |
| `MultiLine.tsx` | Recharts `LineChart` with N `<Line>` from the 6-color ramp |
| `StackedArea.tsx` | Recharts `<Area stackId>` per breakdown bucket |
| `Bar.tsx` | Recharts `<BarChart>` for daily bars |
| `Funnel.tsx` | Custom SVG horizontal funnel; rates labeled between stages |
| `SmallMultiples.tsx` | CSS grid of mini sparklines; shared-Y toggle |
| `Heatmap.tsx` | Custom SVG weekday × week grid (GitHub-contribution style) |

Each component:
- Takes the corresponding `SeriesData` slice + minimal style props.
- Does no fetching, no transformation. Render-only.
- Uses CSS vars for color (`--accent`, `--ok`, `--bad`, plus a new
  `--cat-1..6` ramp added to `globals.css`).
- jsdom-renderable for smoke tests, matching the existing chart-test pattern.

### 6.3 `ConfigurableDashboard` + `CardEditor` (client)

`src/components/dashboard/`

| File | Purpose |
|---|---|
| `ConfigurableDashboard.tsx` | Renders cards in a responsive grid; "+ Add chart" button; per-card ✎ / ↑ / ↓ / 🗑 controls; debounced save to `/api/dashboards/[id]`. |
| `ChartCardFrame.tsx` | `<Card>` wrapper with header (title, range chips, compare toggle) and viz body. Owns the inline-controls state (range/compare changes never need a save — they re-derive `SeriesData` client-side over already-loaded raw data). |
| `CardEditor.tsx` | Right-anchored slide-over (~420px, glass material). Form for metric / viz / appIds / breakdown / bucket / keywordTerm. Live preview rendered inside the panel by re-running `buildSeries` on cached raw data. Save / Cancel. |
| `defaults.ts` | Initial cards for `glance` and `app:<appId>` when the file is empty. |

### 6.4 API routes

`src/app/api/dashboards/[id]/route.ts`

| Method | Behavior |
|---|---|
| `GET` | Returns `DashboardsFile.byId[id] ?? defaults(id)`. Auth-gated by existing middleware. |
| `POST` | Body validated against the `ChartCard[]` shape. Writes through `makeStore(...)`. Returns the new `updatedAt`. |

### 6.5 Page wiring

- `src/app/page.tsx` (Glance):
  - SSR: load `dashboards.json`, the raw monthly JSON for every visible app
    across the widest range used by any card (capped at 365 days), and the
    app meta list.
  - Render `<ConfigurableDashboard id="glance" initialDashboard={...}
    rawBundle={...} apps={...} />` below the existing KPI tiles.
- `src/app/app/[appId]/page.tsx`:
  - SSR: load `dashboards.json` slice `app:<appId>`, raw monthly JSON for
    that app over the widest range used.
  - Replace the lone `<LineArea>` with `<ConfigurableDashboard id={"app:" +
    appId} initialDashboard={...} rawBundle={...} apps={[meta]} />`.

The raw bundle pattern keeps editor previews instant: changing range /
breakdown / compare in the editor re-runs `buildSeries` over cached raw data
in the browser, no server round-trip.

## 7. Editor UX details

**Inline (on the card header), no save needed:**
- Range chip group: `7d 30d 90d MTD YTD All` — active pill animates.
- Compare toggle: "vs. previous period" — adds dashed overlay.

**Slide-over (✎ icon or "+ Add chart"):**
- Title (text input).
- Metric (grouped select: Acquisition / Engagement / Quality / Money / Keywords). Headings rendered as disabled options.
- Visualization (icon picker; incompatible options greyed out per matrix in §5.3).
- Apps (multi-select chips; only on Glance; shows app names from meta).
- Bucket (`day | week | month`; auto-disabled options that don't make sense for the range — e.g. `month` for `7d`).
- Breakdown (filtered to those that actually exist for the metric).
- Keyword term (text input; only when `metric=keywordRank`).
- Live preview pane on the right side of the slide-over; updates as inputs change.
- Save (commits dashboards.json — toast on success) / Cancel.

**Per-card menu:**
- ↑ / ↓ reorder.
- 🗑 delete (with single confirmation step).
- ✎ open editor pre-filled with current values.

## 8. Defaults (loaded when the file is empty)

### 8.1 Glance defaults

1. **Total downloads** — `multiLine`, 30d, `breakdown=app`, compare off.
2. **Acquisition funnel** — `funnel`, 30d, `appIds=all` (summed).
3. **Active devices** — `stackedArea`, 90d, `breakdown=app`.
4. **Avg rating** — `multiLine`, 90d, `breakdown=app`.

### 8.2 Per-app defaults

1. **Downloads** — `area`, 30d, `compare=prevPeriod`.
2. **Conversion funnel** — `funnel`, 30d.
3. **Traffic by source** — `stackedArea`, 30d, `breakdown=source`.
4. **Activity heatmap** — `heatmap`, 90d, `metric=downloads`.

Synthetic example of a single saved card:

```json
{
  "id": "0c4f1c4f-1c4f-4c4f-8c4f-1c4f1c4f1c4f",
  "title": "Total downloads",
  "metric": "downloads",
  "viz": "multiLine",
  "appIds": "all",
  "range": "30d",
  "bucket": "day",
  "breakdown": "app",
  "compare": "none"
}
```

## 9. Styling

- All cards reuse `<Card>` (existing `glass` token).
- New CSS vars in `src/app/globals.css`:
  - `--cat-1` … `--cat-6` — a 6-color categorical ramp aligned to Daylight Frost (cool-leaning, lower saturation than `--accent`).
  - `--chart-grid` — subtle grid stroke.
- Recharts wrappers pull stroke/fill from CSS vars so theme tweaks stay in one file.
- Editor slide-over: right-anchored, ~420px wide, same `glass` material as cards, `backdrop-filter: blur` consistent with Nav.
- 21st.dev-flavored micro-interactions: pill animation on range change, soft-shadow tooltip card, hover scrubber on the time axis (Recharts `<Brush>` deferred — out of scope for v1).

## 10. Test plan

- **`buildSeries` (unit, primary safety net):** one fixture per metric class × breakdown × bucket × compare combination that ships in defaults. ~25 cases. Drives correctness.
- **viz smoke tests:** one jsdom render per viz component with a representative `SeriesData` payload; asserts no throws and presence of key DOM nodes (axes, series labels, stage labels). Matches existing chart-test pattern.
- **`POST /api/dashboards/[id]` integration:** mock store backend; verify payload validation, write call, and 401 when unauthenticated.
- **`ConfigurableDashboard` interaction:** Vitest + `@testing-library/react`; add card → edit → save → reorder → delete; verify state and persistence calls.

## 11. Risks & open follow-ups

- **Raw bundle SSR payload size.** Loading 90d of analytics for every app on Glance to power editor previews could push the initial HTML size up. Mitigation: cap the SSR bundle at the widest range any card actually uses; lazy-fetch wider ranges from the client only when the editor opens.
- **Cron 60s cap unchanged.** Charts are read-side only — no new collector work — so the cap is not at risk. Verified.
- **Recharts bundle weight.** Already in the bundle; adding new viz adds only the chart types used. Funnel and Heatmap are custom SVG, not Recharts — keeps weight flat.
- **dashboards.json contention.** Writes are user-triggered and infrequent; the existing retry-on-409 backoff already handles the cron-vs-user collision case.

## 12. Where to look first

- This spec, then the parent spec for any constraint context.
- `src/lib/aggregate/downloads.ts` — model for the new `series.ts` (pure, testable).
- `src/components/charts/LineArea.tsx` — pattern the new viz components follow.
- `src/lib/store/github.ts` — the write layer all persistence goes through.
- `src/app/page.tsx` and `src/app/app/[appId]/page.tsx` — the two pages that get the new dashboard component.
