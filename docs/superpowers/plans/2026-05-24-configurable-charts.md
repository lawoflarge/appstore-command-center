# Configurable Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-configurable chart dashboards to the Glance home (`/`) and per-app page (`/app/[appId]`). Operator can add/edit/reorder/delete cards from the deployed site; config persists to the data repo's `data/dashboards.json` via the existing git-as-DB write layer.

**Architecture:** One `ChartCard` config shape drives all seven viz types. A pure `buildSeries(card, raw)` function turns raw monthly JSON into viz-specific payloads — fully testable. Dumb viz components render Recharts/SVG. A client `ConfigurableDashboard` holds the cards, opens a slide-over `CardEditor`, and POSTs to `/api/dashboards/[id]` which writes via `makeStore`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, Recharts 3 (already in deps), Zod 4 (already in deps), Vitest + React Testing Library (already configured).

**Spec:** [`docs/superpowers/specs/2026-05-24-configurable-charts-design.md`](../specs/2026-05-24-configurable-charts-design.md)

---

## File Structure

**New files:**
| Path | Purpose |
|---|---|
| `src/lib/dashboards/types.ts` | `ChartCard`, `DashboardsFile`, `Metric`, `Viz`, `Range`, `Bucket`, `Breakdown`, `SeriesData` types |
| `src/lib/dashboards/defaults.ts` | `defaultsFor(id)` → default cards for glance / per-app |
| `src/lib/dashboards/compatibility.ts` | `isCompatible(metric, viz, breakdown)` lookup matrix |
| `src/lib/dashboards/schema.ts` | Zod schema for POST validation |
| `src/lib/aggregate/series.ts` | `buildSeries(card, raw)` pure function |
| `src/lib/aggregate/rawBundle.ts` | `loadRawBundle(store, appIds, today, months)` SSR loader |
| `src/components/charts/viz/Area.tsx` | Single-series area + optional compare overlay |
| `src/components/charts/viz/MultiLine.tsx` | N-series line chart |
| `src/components/charts/viz/StackedArea.tsx` | Stacked area for breakdowns |
| `src/components/charts/viz/Bar.tsx` | Daily bar chart |
| `src/components/charts/viz/Funnel.tsx` | Custom horizontal funnel with conversion rates |
| `src/components/charts/viz/SmallMultiples.tsx` | Grid of mini sparklines |
| `src/components/charts/viz/Heatmap.tsx` | Custom SVG calendar heatmap |
| `src/components/charts/viz/VizRenderer.tsx` | Switch by `SeriesData.kind` → dispatches to viz |
| `src/components/dashboard/ChartCardFrame.tsx` | Card chrome: title, range chips, compare toggle, edit/delete/reorder buttons |
| `src/components/dashboard/CardEditor.tsx` | Right slide-over with live preview |
| `src/components/dashboard/ConfigurableDashboard.tsx` | Grid + add/reorder/delete + persistence |
| `src/app/api/dashboards/[id]/route.ts` | GET / POST handlers |

**Modified files:**
| Path | Change |
|---|---|
| `src/lib/store/paths.ts` | Add `dashboardsPath()` constant |
| `src/app/globals.css` | Add `--cat-1..6` ramp + `--chart-grid` CSS vars |
| `src/app/page.tsx` | Render `<ConfigurableDashboard id="glance">` below existing KPI tiles |
| `src/app/app/[appId]/page.tsx` | Replace lone `<LineArea>` with `<ConfigurableDashboard id={"app:" + appId}>` |

**Deleted files:**
| Path | Why |
|---|---|
| `src/components/charts/LineArea.tsx` | Behavior subsumed by `viz/Area.tsx` |
| `tests/components/linearea.test.tsx` | Replaced by `tests/components/charts/viz.test.tsx` |

**Test files (new):**
| Path | Covers |
|---|---|
| `tests/lib/dashboards/defaults.test.ts` | Glance + per-app defaults |
| `tests/lib/dashboards/compatibility.test.ts` | Matrix correctness |
| `tests/lib/dashboards/schema.test.ts` | Zod schema accepts/rejects |
| `tests/lib/aggregate/series.test.ts` | `buildSeries` for every shape × metric × bucket × compare combo |
| `tests/components/charts/viz.test.tsx` | One smoke render per viz |
| `tests/components/dashboard/configurable-dashboard.test.tsx` | Add/edit/reorder/delete interactions |
| `tests/components/dashboard/card-editor.test.tsx` | Live-preview re-runs on input change |
| `tests/app/dashboards-route.test.ts` | GET defaults, POST validation, 401 unauthenticated |

---

## Conventions (read these once)

- **pnpm only.** Never run `npm`/`yarn install` — generates wrong lockfile.
- **Tests:** `pnpm test` for full suite; `pnpm vitest run <path>` for one file.
- **Build/lint:** `pnpm build` (strict — fails on any lint or type error).
- **Path alias:** `@/` → `src/`.
- **Existing chart pattern:** `src/components/charts/LineArea.tsx` (Recharts + `"use client"` + `ResponsiveContainer`).
- **Existing route pattern:** `src/app/api/config/route.ts` (auth gate → `makeStore(ghBackendFromEnv())` → JSON response).
- **Existing aggregate pattern:** `src/lib/aggregate/downloads.ts` (pure, sortable, no I/O).
- **Existing test pattern:** `tests/lib/aggregate/downloads.test.ts` + `tests/components/linearea.test.tsx`.
- **Commit style:** conventional, lowercase scope. Examples in tasks below.
- **Branch:** stay on `feat/configurable-charts` (already created).

---

## Task 1: Types module

**Files:**
- Create: `src/lib/dashboards/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/lib/dashboards/types.ts

export type Metric =
  | "downloads" | "redownloads" | "proceedsUsd"
  | "impressions" | "pageViews" | "sessions"
  | "activeDevices" | "deletions" | "crashes"
  | "convPageToInstall" | "convImpressionToPage"
  | "avgRating" | "ratingsCount"
  | "reviewCount" | "responseRate"
  | "keywordRank";

export type Viz =
  | "area" | "multiLine" | "stackedArea" | "bar"
  | "funnel" | "smallMultiples" | "heatmap";

export type Range = "7d" | "30d" | "90d" | "mtd" | "ytd" | "all";
export type Bucket = "day" | "week" | "month";
export type Breakdown = "none" | "country" | "source" | "app";
export type Compare = "none" | "prevPeriod";

export interface ChartCard {
  id: string;
  title: string;
  metric: Metric;
  viz: Viz;
  appIds: "all" | string[];
  range: Range;
  bucket: Bucket;
  breakdown: Breakdown;
  compare: Compare;
  keywordTerm?: string;
}

export interface DashboardSlice {
  cards: ChartCard[];
  updatedAt: string; // ISO 8601 UTC
}

export interface DashboardsFile {
  byId: Record<string, DashboardSlice>; // keys: "glance" | "app:<appId>"
}

export interface Point { day: string; value: number }

export type SeriesData =
  | { kind: "area"; points: Point[]; compare?: Point[] }
  | { kind: "bar"; points: Point[]; compare?: Point[] }
  | { kind: "heatmap"; points: Point[] }
  | { kind: "multiLine"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "stackedArea"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "smallMultiples"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "funnel"; stages: { label: string; value: number; rate?: number }[] };
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: clean exit (no output).

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/types.ts
git commit -m "feat(dashboards): add ChartCard + SeriesData types"
```

---

## Task 2: Persistence path constant

**Files:**
- Modify: `src/lib/store/paths.ts`

- [ ] **Step 1: Add the path constant**

Open `src/lib/store/paths.ts`. After the existing `insightsPath` line, add:

```ts
export const dashboardsPath = () => `data/dashboards.json`;
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store/paths.ts
git commit -m "feat(store): add dashboards.json path constant"
```

---

## Task 3: Compatibility matrix

**Files:**
- Create: `src/lib/dashboards/compatibility.ts`
- Test: `tests/lib/dashboards/compatibility.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dashboards/compatibility.test.ts
import { describe, it, expect } from "vitest";
import { isVizCompatible, isBreakdownCompatible, vizForMetric } from "@/lib/dashboards/compatibility";

describe("isVizCompatible", () => {
  it("allows area for downloads", () => {
    expect(isVizCompatible("downloads", "area")).toBe(true);
  });
  it("rejects funnel for downloads (funnel is a synthetic viz, not metric-paired)", () => {
    expect(isVizCompatible("downloads", "funnel")).toBe(false);
  });
  it("rejects stackedArea for avgRating", () => {
    expect(isVizCompatible("avgRating", "stackedArea")).toBe(false);
  });
  it("rejects heatmap for keywordRank", () => {
    expect(isVizCompatible("keywordRank", "heatmap")).toBe(false);
  });
});

describe("isBreakdownCompatible", () => {
  it("allows country for downloads", () => {
    expect(isBreakdownCompatible("downloads", "country")).toBe(true);
  });
  it("rejects source for downloads (sales has no bySource)", () => {
    expect(isBreakdownCompatible("downloads", "source")).toBe(false);
  });
  it("allows source for pageViews (analytics has bySource)", () => {
    expect(isBreakdownCompatible("pageViews", "source")).toBe(true);
  });
  it("always allows none", () => {
    expect(isBreakdownCompatible("avgRating", "none")).toBe(true);
  });
});

describe("vizForMetric", () => {
  it("returns the compatible viz list for downloads", () => {
    const v = vizForMetric("downloads");
    expect(v).toContain("area");
    expect(v).toContain("multiLine");
    expect(v).toContain("heatmap");
    expect(v).not.toContain("funnel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/dashboards/compatibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/dashboards/compatibility.ts
import type { Metric, Viz, Breakdown } from "./types";

type MetricClass = "sales" | "analytics" | "derived" | "ratings" | "reviews" | "keywords";

const METRIC_CLASS: Record<Metric, MetricClass> = {
  downloads: "sales", redownloads: "sales", proceedsUsd: "sales",
  impressions: "analytics", pageViews: "analytics", sessions: "analytics",
  activeDevices: "analytics", deletions: "analytics", crashes: "analytics",
  convPageToInstall: "derived", convImpressionToPage: "derived",
  avgRating: "ratings", ratingsCount: "ratings",
  reviewCount: "reviews", responseRate: "reviews",
  keywordRank: "keywords",
};

// `funnel` is excluded from every metric's list — UI offers funnel as a
// standalone viz that sums analytics-funnel stages across apps.
const VIZ_BY_CLASS: Record<MetricClass, Viz[]> = {
  sales:     ["area", "multiLine", "stackedArea", "bar", "smallMultiples", "heatmap"],
  analytics: ["area", "multiLine", "stackedArea", "bar", "smallMultiples", "heatmap"],
  derived:   ["area", "multiLine", "smallMultiples"],
  ratings:   ["area", "multiLine", "smallMultiples"],
  reviews:   ["area", "multiLine", "bar", "smallMultiples"],
  keywords:  ["area", "multiLine"],
};

const BREAKDOWN_BY_CLASS: Record<MetricClass, Breakdown[]> = {
  sales:     ["none", "country", "app"],
  analytics: ["none", "source", "app"],
  derived:   ["none", "app"],
  ratings:   ["none", "country", "app"],
  reviews:   ["none", "app"],
  keywords:  ["none", "app"],
};

export function isVizCompatible(metric: Metric, viz: Viz): boolean {
  return VIZ_BY_CLASS[METRIC_CLASS[metric]].includes(viz);
}

export function isBreakdownCompatible(metric: Metric, breakdown: Breakdown): boolean {
  return BREAKDOWN_BY_CLASS[METRIC_CLASS[metric]].includes(breakdown);
}

export function vizForMetric(metric: Metric): Viz[] {
  return [...VIZ_BY_CLASS[METRIC_CLASS[metric]]];
}

export function breakdownForMetric(metric: Metric): Breakdown[] {
  return [...BREAKDOWN_BY_CLASS[METRIC_CLASS[metric]]];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/dashboards/compatibility.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/compatibility.ts tests/lib/dashboards/compatibility.test.ts
git commit -m "feat(dashboards): metric × viz × breakdown compatibility matrix"
```

---

## Task 4: Defaults module

**Files:**
- Create: `src/lib/dashboards/defaults.ts`
- Test: `tests/lib/dashboards/defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dashboards/defaults.test.ts
import { describe, it, expect } from "vitest";
import { defaultsFor } from "@/lib/dashboards/defaults";

describe("defaultsFor", () => {
  it("glance returns 4 cards including a funnel and a multi-line", () => {
    const slice = defaultsFor("glance");
    expect(slice.cards).toHaveLength(4);
    const vizCounts = slice.cards.map((c) => c.viz).sort();
    expect(vizCounts).toEqual(["funnel", "multiLine", "multiLine", "stackedArea"]);
    expect(slice.cards.find((c) => c.metric === "downloads")?.breakdown).toBe("app");
  });

  it("per-app returns 4 cards with the app id pinned", () => {
    const slice = defaultsFor("app:1234");
    expect(slice.cards).toHaveLength(4);
    for (const c of slice.cards) {
      expect(c.appIds).toEqual(["1234"]);
    }
    expect(slice.cards.find((c) => c.viz === "heatmap")?.metric).toBe("downloads");
  });

  it("ids are unique within a slice", () => {
    const slice = defaultsFor("glance");
    const ids = new Set(slice.cards.map((c) => c.id));
    expect(ids.size).toBe(slice.cards.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/dashboards/defaults.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/dashboards/defaults.ts
import type { ChartCard, DashboardSlice } from "./types";

let counter = 0;
const id = () => `default-${++counter}-${Math.random().toString(36).slice(2, 10)}`;

function glanceCards(): ChartCard[] {
  return [
    { id: id(), title: "Total downloads", metric: "downloads", viz: "multiLine",
      appIds: "all", range: "30d", bucket: "day", breakdown: "app", compare: "none" },
    { id: id(), title: "Acquisition funnel", metric: "downloads", viz: "funnel",
      appIds: "all", range: "30d", bucket: "day", breakdown: "none", compare: "none" },
    { id: id(), title: "Active devices", metric: "activeDevices", viz: "stackedArea",
      appIds: "all", range: "90d", bucket: "day", breakdown: "app", compare: "none" },
    { id: id(), title: "Avg rating", metric: "avgRating", viz: "multiLine",
      appIds: "all", range: "90d", bucket: "day", breakdown: "app", compare: "none" },
  ];
}

function perAppCards(appId: string): ChartCard[] {
  return [
    { id: id(), title: "Downloads", metric: "downloads", viz: "area",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "none", compare: "prevPeriod" },
    { id: id(), title: "Conversion funnel", metric: "downloads", viz: "funnel",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "none", compare: "none" },
    { id: id(), title: "Traffic by source", metric: "pageViews", viz: "stackedArea",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "source", compare: "none" },
    { id: id(), title: "Activity heatmap", metric: "downloads", viz: "heatmap",
      appIds: [appId], range: "90d", bucket: "day", breakdown: "none", compare: "none" },
  ];
}

export function defaultsFor(dashboardId: string): DashboardSlice {
  const cards = dashboardId === "glance"
    ? glanceCards()
    : perAppCards(dashboardId.replace(/^app:/, ""));
  return { cards, updatedAt: new Date(0).toISOString() };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/lib/dashboards/defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/defaults.ts tests/lib/dashboards/defaults.test.ts
git commit -m "feat(dashboards): default cards for glance + per-app"
```

---

## Task 5: Zod schema for validation

**Files:**
- Create: `src/lib/dashboards/schema.ts`
- Test: `tests/lib/dashboards/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dashboards/schema.test.ts
import { describe, it, expect } from "vitest";
import { chartCardSchema, dashboardSliceSchema } from "@/lib/dashboards/schema";

const valid = {
  id: "abc", title: "T", metric: "downloads", viz: "area",
  appIds: "all", range: "30d", bucket: "day", breakdown: "none", compare: "none",
};

describe("chartCardSchema", () => {
  it("accepts a valid card", () => {
    expect(chartCardSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an unknown metric", () => {
    expect(chartCardSchema.safeParse({ ...valid, metric: "wat" }).success).toBe(false);
  });
  it("rejects an unknown viz", () => {
    expect(chartCardSchema.safeParse({ ...valid, viz: "pie" }).success).toBe(false);
  });
  it("accepts an array of app ids", () => {
    expect(chartCardSchema.safeParse({ ...valid, appIds: ["1", "2"] }).success).toBe(true);
  });
});

describe("dashboardSliceSchema", () => {
  it("accepts a slice with one valid card", () => {
    const r = dashboardSliceSchema.safeParse({ cards: [valid], updatedAt: new Date().toISOString() });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/dashboards/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/dashboards/schema.ts
import { z } from "zod";

export const metricSchema = z.enum([
  "downloads", "redownloads", "proceedsUsd",
  "impressions", "pageViews", "sessions",
  "activeDevices", "deletions", "crashes",
  "convPageToInstall", "convImpressionToPage",
  "avgRating", "ratingsCount",
  "reviewCount", "responseRate",
  "keywordRank",
]);

export const vizSchema = z.enum([
  "area", "multiLine", "stackedArea", "bar",
  "funnel", "smallMultiples", "heatmap",
]);

export const chartCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  metric: metricSchema,
  viz: vizSchema,
  appIds: z.union([z.literal("all"), z.array(z.string().min(1))]),
  range: z.enum(["7d", "30d", "90d", "mtd", "ytd", "all"]),
  bucket: z.enum(["day", "week", "month"]),
  breakdown: z.enum(["none", "country", "source", "app"]),
  compare: z.enum(["none", "prevPeriod"]),
  keywordTerm: z.string().optional(),
});

export const dashboardSliceSchema = z.object({
  cards: z.array(chartCardSchema).max(40),
  updatedAt: z.string(),
});
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/lib/dashboards/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/schema.ts tests/lib/dashboards/schema.test.ts
git commit -m "feat(dashboards): zod schema for POST validation"
```

---

## Task 6: series-builder — windowing + single-series shapes (area / bar / heatmap)

**Files:**
- Create: `src/lib/aggregate/series.ts`
- Test: `tests/lib/aggregate/series.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/aggregate/series.test.ts
import { describe, it, expect } from "vitest";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import type { ChartCard } from "@/lib/dashboards/types";

const fakeBundle = (): RawBundle => ({
  apps: { "1": { name: "Alpha" }, "2": { name: "Beta" } },
  sales: {
    "1": [
      { day: "2026-05-20", byCountry: { US: 10 }, total: 10, redownloads: 1, proceedsUsd: 5 },
      { day: "2026-05-21", byCountry: { US: 12 }, total: 12, redownloads: 0, proceedsUsd: 6 },
      { day: "2026-05-22", byCountry: { US: 14 }, total: 14, redownloads: 2, proceedsUsd: 7 },
    ],
    "2": [
      { day: "2026-05-22", byCountry: { US: 4 }, total: 4, redownloads: 0, proceedsUsd: 2 },
    ],
  },
  analytics: { "1": [], "2": [] },
  ratings: { "1": [], "2": [] },
  reviews: { "1": [], "2": [] },
  keywords: { "1": [], "2": [] },
  today: "2026-05-22",
});

const baseCard: ChartCard = {
  id: "c1", title: "Downloads", metric: "downloads", viz: "area",
  appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none",
};

describe("buildSeries — area", () => {
  it("returns daily points within the range", () => {
    const r = buildSeries(baseCard, fakeBundle());
    expect(r.kind).toBe("area");
    if (r.kind !== "area") return;
    expect(r.points).toEqual([
      { day: "2026-05-20", value: 10 },
      { day: "2026-05-21", value: 12 },
      { day: "2026-05-22", value: 14 },
    ]);
  });

  it("sums across multiple apps when appIds=all", () => {
    const r = buildSeries({ ...baseCard, appIds: "all" }, fakeBundle());
    if (r.kind !== "area") throw new Error();
    const may22 = r.points.find((p) => p.day === "2026-05-22");
    expect(may22?.value).toBe(18); // 14 + 4
  });
});

describe("buildSeries — bar", () => {
  it("returns the same point shape as area", () => {
    const r = buildSeries({ ...baseCard, viz: "bar" }, fakeBundle());
    expect(r.kind).toBe("bar");
  });
});

describe("buildSeries — heatmap", () => {
  it("returns one point per day", () => {
    const r = buildSeries({ ...baseCard, viz: "heatmap", range: "30d" }, fakeBundle());
    expect(r.kind).toBe("heatmap");
  });
});

describe("buildSeries — range windowing", () => {
  it("7d range keeps last 7 days inclusive of today", () => {
    const bundle = fakeBundle();
    const r = buildSeries({ ...baseCard, range: "7d" }, bundle);
    if (r.kind !== "area") throw new Error();
    for (const p of r.points) {
      expect(p.day >= "2026-05-16").toBe(true);
      expect(p.day <= "2026-05-22").toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module skeleton + single-series logic**

```ts
// src/lib/aggregate/series.ts
import type { ChartCard, Metric, SeriesData, Point } from "@/lib/dashboards/types";
import type {
  SalesDay, AnalyticsDay, RatingPoint, Review, KeywordRank, AppMeta,
} from "@/lib/store/paths";

export interface RawBundle {
  apps: Record<string, Pick<AppMeta, "name">>;
  sales:     Record<string, SalesDay[]>;
  analytics: Record<string, AnalyticsDay[]>;
  ratings:   Record<string, RatingPoint[]>;
  reviews:   Record<string, Review[]>;
  keywords:  Record<string, KeywordRank[]>;
  today: string; // YYYY-MM-DD, UTC
}

function rangeWindow(range: ChartCard["range"], today: string): { from: string; to: string } {
  if (range === "all") return { from: "0000-01-01", to: today };
  const to = today;
  const t = new Date(today + "T00:00:00Z");
  if (range === "mtd") return { from: today.slice(0, 8) + "01", to };
  if (range === "ytd") return { from: today.slice(0, 4) + "-01-01", to };
  const days = range === "7d" ? 6 : range === "30d" ? 29 : 89;
  t.setUTCDate(t.getUTCDate() - days);
  return { from: t.toISOString().slice(0, 10), to };
}

function inWindow(day: string, w: { from: string; to: string }): boolean {
  return day >= w.from && day <= w.to;
}

function appIdsFor(card: ChartCard, raw: RawBundle): string[] {
  return card.appIds === "all" ? Object.keys(raw.apps) : card.appIds;
}

function metricValueFromRow(
  metric: Metric, src: "sales" | "analytics" | "ratings",
  row: SalesDay | AnalyticsDay | RatingPoint,
): number {
  if (src === "sales") {
    const r = row as SalesDay;
    if (metric === "downloads") return r.total;
    if (metric === "redownloads") return r.redownloads;
    if (metric === "proceedsUsd") return r.proceedsUsd;
  }
  if (src === "analytics") {
    const r = row as AnalyticsDay;
    if (metric === "downloads") return r.downloads;
    if (metric === "impressions") return r.impressions;
    if (metric === "pageViews") return r.pageViews;
    if (metric === "sessions") return r.sessions;
    if (metric === "activeDevices") return r.activeDevices;
    if (metric === "deletions") return r.deletions;
    if (metric === "crashes") return r.crashes;
  }
  if (src === "ratings") {
    const r = row as RatingPoint;
    if (metric === "avgRating") return r.avg;
    if (metric === "ratingsCount") return r.count;
  }
  return 0;
}

function sourceFor(metric: Metric): "sales" | "analytics" | "ratings" | "reviews" | "keywords" | "derived" {
  if (["downloads", "redownloads", "proceedsUsd"].includes(metric)) return "sales";
  if (["impressions", "pageViews", "sessions", "activeDevices", "deletions", "crashes"].includes(metric)) return "analytics";
  if (["avgRating", "ratingsCount"].includes(metric)) return "ratings";
  if (["reviewCount", "responseRate"].includes(metric)) return "reviews";
  if (metric === "keywordRank") return "keywords";
  return "derived";
}

function appDayMap(card: ChartCard, appId: string, raw: RawBundle): Map<string, number> {
  const src = sourceFor(card.metric);
  const out = new Map<string, number>();
  if (src === "sales") {
    for (const r of raw.sales[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "sales", r));
  } else if (src === "analytics") {
    for (const r of raw.analytics[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "analytics", r));
  } else if (src === "ratings") {
    for (const r of raw.ratings[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "ratings", r));
  }
  return out;
}

function summedDailySeries(card: ChartCard, raw: RawBundle): Point[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const merged = new Map<string, number>();
  for (const appId of apps) {
    for (const [day, val] of appDayMap(card, appId, raw)) {
      if (!inWindow(day, window)) continue;
      merged.set(day, (merged.get(day) ?? 0) + val);
    }
  }
  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, value }));
}

export function buildSeries(card: ChartCard, raw: RawBundle): SeriesData {
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    return { kind: card.viz, points };
  }
  throw new Error(`viz "${card.viz}" not yet implemented`);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: PASS — 5 green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate/series.ts tests/lib/aggregate/series.test.ts
git commit -m "feat(aggregate): buildSeries skeleton + area/bar/heatmap shapes"
```

---

## Task 7: series-builder — multiLine / stackedArea / smallMultiples (breakdown grouping)

**Files:**
- Modify: `src/lib/aggregate/series.ts`
- Modify: `tests/lib/aggregate/series.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/lib/aggregate/series.test.ts`:

```ts
describe("buildSeries — multiLine breakdown=app", () => {
  it("returns one series per app", () => {
    const card: ChartCard = { ...baseCard, viz: "multiLine", appIds: "all", breakdown: "app" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "multiLine") throw new Error();
    expect(r.series).toHaveLength(2);
    const alpha = r.series.find((s) => s.key === "1");
    expect(alpha?.label).toBe("Alpha");
    expect(alpha?.points.at(-1)?.value).toBe(14);
  });
});

describe("buildSeries — stackedArea breakdown=country", () => {
  it("returns one series per country across the window", () => {
    const card: ChartCard = { ...baseCard, viz: "stackedArea", appIds: "all", breakdown: "country" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "stackedArea") throw new Error();
    expect(r.series.some((s) => s.key === "US")).toBe(true);
  });
});

describe("buildSeries — smallMultiples", () => {
  it("returns one mini series per app regardless of breakdown", () => {
    const card: ChartCard = { ...baseCard, viz: "smallMultiples", appIds: "all", breakdown: "none" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "smallMultiples") throw new Error();
    expect(r.series).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: 3 new failures (viz not implemented).

- [ ] **Step 3: Extend the module**

Add these helpers to `src/lib/aggregate/series.ts` above `buildSeries`:

```ts
function breakdownByApp(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  return apps.map((appId) => {
    const dayMap = appDayMap(card, appId, raw);
    const points = [...dayMap.entries()]
      .filter(([day]) => inWindow(day, window))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, value }));
    return { key: appId, label: raw.apps[appId]?.name ?? appId, points };
  }).filter((s) => s.points.length > 0);
}

function breakdownByCountry(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const perCountry = new Map<string, Map<string, number>>();
  for (const appId of apps) {
    for (const r of raw.sales[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      for (const [country, v] of Object.entries(r.byCountry)) {
        if (!perCountry.has(country)) perCountry.set(country, new Map());
        const m = perCountry.get(country)!;
        m.set(r.day, (m.get(r.day) ?? 0) + v);
      }
    }
  }
  return [...perCountry.entries()].map(([country, m]) => ({
    key: country, label: country,
    points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })),
  }));
}

function breakdownBySource(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const perSource = new Map<string, Map<string, number>>();
  for (const appId of apps) {
    for (const r of raw.analytics[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      for (const [source, v] of Object.entries(r.bySource)) {
        if (!perSource.has(source)) perSource.set(source, new Map());
        const m = perSource.get(source)!;
        m.set(r.day, (m.get(r.day) ?? 0) + v);
      }
    }
  }
  return [...perSource.entries()].map(([source, m]) => ({
    key: source, label: source,
    points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })),
  }));
}

function multiSeries(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  if (card.viz === "smallMultiples") return breakdownByApp({ ...card, appIds: "all" }, raw);
  if (card.breakdown === "country") return breakdownByCountry(card, raw);
  if (card.breakdown === "source")  return breakdownBySource(card, raw);
  return breakdownByApp(card, raw);
}
```

Replace `buildSeries`:

```ts
export function buildSeries(card: ChartCard, raw: RawBundle): SeriesData {
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    return { kind: card.viz, points };
  }
  if (card.viz === "multiLine" || card.viz === "stackedArea" || card.viz === "smallMultiples") {
    return { kind: card.viz, series: multiSeries(card, raw) };
  }
  throw new Error(`viz "${card.viz}" not yet implemented`);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: 8 green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate/series.ts tests/lib/aggregate/series.test.ts
git commit -m "feat(aggregate): multiLine/stackedArea/smallMultiples with breakdown grouping"
```

---

## Task 8: series-builder — funnel

**Files:**
- Modify: `src/lib/aggregate/series.ts`
- Modify: `tests/lib/aggregate/series.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe("buildSeries — funnel", () => {
  it("returns the four analytics-funnel stages with rates between them", () => {
    const bundle = fakeBundle();
    bundle.analytics["1"] = [
      { day: "2026-05-22", impressions: 1000, pageViews: 200, sessions: 60, downloads: 30,
        activeDevices: 50, deletions: 0, crashes: 0, bySource: {} },
    ];
    const card: ChartCard = { ...baseCard, viz: "funnel", appIds: "all", range: "7d" };
    const r = buildSeries(card, bundle);
    if (r.kind !== "funnel") throw new Error();
    expect(r.stages.map((s) => s.label)).toEqual(["Impressions", "Page views", "Sessions", "Downloads"]);
    expect(r.stages[0].value).toBe(1000);
    expect(r.stages[3].value).toBe(30);
    expect(r.stages[1].rate).toBeCloseTo(200 / 1000, 3);
    expect(r.stages[3].rate).toBeCloseTo(30 / 60, 3);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts -t funnel`
Expected: FAIL.

- [ ] **Step 3: Implement funnel branch**

Add helper above `buildSeries`:

```ts
function funnelStages(card: ChartCard, raw: RawBundle): { label: string; value: number; rate?: number }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  let impressions = 0, pageViews = 0, sessions = 0, downloads = 0;
  for (const appId of apps) {
    for (const r of raw.analytics[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      impressions += r.impressions;
      pageViews   += r.pageViews;
      sessions    += r.sessions;
      downloads   += r.downloads;
    }
  }
  const rate = (a: number, b: number) => (b > 0 ? a / b : undefined);
  return [
    { label: "Impressions", value: impressions },
    { label: "Page views",  value: pageViews,  rate: rate(pageViews, impressions) },
    { label: "Sessions",    value: sessions,   rate: rate(sessions, pageViews) },
    { label: "Downloads",   value: downloads,  rate: rate(downloads, sessions) },
  ];
}
```

Update `buildSeries`:

```ts
export function buildSeries(card: ChartCard, raw: RawBundle): SeriesData {
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    return { kind: card.viz, points };
  }
  if (card.viz === "multiLine" || card.viz === "stackedArea" || card.viz === "smallMultiples") {
    return { kind: card.viz, series: multiSeries(card, raw) };
  }
  if (card.viz === "funnel") return { kind: "funnel", stages: funnelStages(card, raw) };
  throw new Error(`unknown viz "${card.viz}"`);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: 9 green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate/series.ts tests/lib/aggregate/series.test.ts
git commit -m "feat(aggregate): funnel shape sums analytics stages with conversion rates"
```

---

## Task 9: series-builder — derived metrics + previous-period compare

**Files:**
- Modify: `src/lib/aggregate/series.ts`
- Modify: `tests/lib/aggregate/series.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("buildSeries — derived metric (convPageToInstall)", () => {
  it("computes downloads / pageViews per day", () => {
    const bundle = fakeBundle();
    bundle.analytics["1"] = [
      { day: "2026-05-22", impressions: 1000, pageViews: 200, sessions: 60, downloads: 30,
        activeDevices: 0, deletions: 0, crashes: 0, bySource: {} },
    ];
    const card: ChartCard = { ...baseCard, metric: "convPageToInstall", viz: "area", appIds: ["1"], range: "7d" };
    const r = buildSeries(card, bundle);
    if (r.kind !== "area") throw new Error();
    expect(r.points[0].value).toBeCloseTo(30 / 200, 3);
  });
});

describe("buildSeries — compare=prevPeriod", () => {
  it("returns a compare array when prevPeriod is requested", () => {
    const card: ChartCard = { ...baseCard, compare: "prevPeriod", range: "7d" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "area") throw new Error();
    expect(Array.isArray(r.compare)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts -t derived`
Expected: FAIL on derived (returns 0).

- [ ] **Step 3: Extend `appDayMap` for derived / reviews / keywords**

Replace `appDayMap` in `src/lib/aggregate/series.ts`:

```ts
function appDayMap(card: ChartCard, appId: string, raw: RawBundle): Map<string, number> {
  const src = sourceFor(card.metric);
  const out = new Map<string, number>();
  if (src === "sales") {
    for (const r of raw.sales[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "sales", r));
  } else if (src === "analytics") {
    for (const r of raw.analytics[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "analytics", r));
  } else if (src === "ratings") {
    for (const r of raw.ratings[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "ratings", r));
  } else if (src === "derived") {
    for (const r of raw.analytics[appId] ?? []) {
      const num = card.metric === "convPageToInstall" ? r.downloads : r.pageViews;
      const den = card.metric === "convPageToInstall" ? r.pageViews  : r.impressions;
      if (den > 0) out.set(r.day, num / den);
    }
  } else if (src === "reviews") {
    if (card.metric === "reviewCount") {
      for (const rv of raw.reviews[appId] ?? []) {
        const day = rv.createdDate.slice(0, 10);
        out.set(day, (out.get(day) ?? 0) + 1);
      }
    } else if (card.metric === "responseRate") {
      const counts = new Map<string, number>();
      const responded = new Map<string, number>();
      for (const rv of raw.reviews[appId] ?? []) {
        const day = rv.createdDate.slice(0, 10);
        counts.set(day, (counts.get(day) ?? 0) + 1);
        if (rv.responded) responded.set(day, (responded.get(day) ?? 0) + 1);
      }
      for (const [day, total] of counts) out.set(day, (responded.get(day) ?? 0) / total);
    }
  } else if (src === "keywords") {
    for (const r of raw.keywords[appId] ?? []) {
      if (card.keywordTerm && r.term !== card.keywordTerm) continue;
      if (r.rank != null) out.set(r.day, r.rank);
    }
  }
  return out;
}
```

- [ ] **Step 4: Add compare overlay to single-series shapes**

In `buildSeries`, replace the area/bar/heatmap branch with:

```ts
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    if (card.viz !== "heatmap" && card.compare === "prevPeriod") {
      const compare = previousPeriodSeries(card, raw);
      return { kind: card.viz, points, compare };
    }
    return { kind: card.viz, points };
  }
```

Add helper above `buildSeries`:

```ts
function previousPeriodSeries(card: ChartCard, raw: RawBundle): Point[] {
  const cur = rangeWindow(card.range, raw.today);
  const from = new Date(cur.from + "T00:00:00Z");
  const to   = new Date(cur.to   + "T00:00:00Z");
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);
  const shifted: ChartCard = { ...card, range: "all", compare: "none" };
  const all = summedDailySeries(shifted, { ...raw, today: prevTo.toISOString().slice(0, 10) });
  const fromIso = prevFrom.toISOString().slice(0, 10);
  const prevToIso = prevTo.toISOString().slice(0, 10);
  return all
    .filter((p) => p.day >= fromIso && p.day <= prevToIso)
    .map((p) => {
      const d = new Date(p.day + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + spanDays);
      return { day: d.toISOString().slice(0, 10), value: p.value };
    });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/lib/aggregate/series.test.ts`
Expected: all 11 green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aggregate/series.ts tests/lib/aggregate/series.test.ts
git commit -m "feat(aggregate): derived conversion metrics + prev-period compare"
```

---

## Task 10: CSS chart vars

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add CSS variables**

In `src/app/globals.css`, in the `:root` block, after the `--star` line, add:

```css
  --cat-1:#6d5dfb; --cat-2:#10b981; --cat-3:#f59e0b; --cat-4:#ef4444; --cat-5:#0ea5e9; --cat-6:#a855f7;
  --chart-grid:rgba(28,32,48,.08);
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(style): categorical chart colors + grid stroke vars"
```

---

## Task 11: viz/Area component (migrate LineArea + compare overlay)

**Files:**
- Create: `src/components/charts/viz/Area.tsx`
- Test: `tests/components/charts/viz.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

```tsx
// tests/components/charts/viz.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Area } from "@/components/charts/viz/Area";

describe("Area viz", () => {
  it("renders without throwing", () => {
    const { container } = render(
      <Area data={{ kind: "area", points: [{ day: "2026-05-22", value: 10 }] }} />
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders compare overlay when provided", () => {
    const { container } = render(
      <Area data={{
        kind: "area",
        points: [{ day: "2026-05-22", value: 10 }],
        compare: [{ day: "2026-05-22", value: 5 }],
      }} />
    );
    expect(container.querySelectorAll("path").length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/components/charts/viz/Area.tsx
"use client";
import { AreaChart, Area as A, XAxis, YAxis, Tooltip, ResponsiveContainer, Line } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function Area({ data }: { data: Extract<SeriesData, { kind: "area" }> }) {
  const compareMap = new Map((data.compare ?? []).map((p) => [p.day, p.value]));
  const rows = data.points.map((p) => ({ day: p.day, value: p.value, compare: compareMap.get(p.day) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        {data.compare && (
          <Line type="monotone" dataKey="compare" stroke="var(--ink-2)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
        )}
        <A type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} fill="url(#g-area)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: PASS — 2 green.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/viz/Area.tsx tests/components/charts/viz.test.tsx
git commit -m "feat(charts): Area viz with optional compare overlay"
```

---

## Task 12: viz/MultiLine + viz/StackedArea + viz/Bar

**Files:**
- Create: `src/components/charts/viz/MultiLine.tsx`
- Create: `src/components/charts/viz/StackedArea.tsx`
- Create: `src/components/charts/viz/Bar.tsx`
- Modify: `tests/components/charts/viz.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `tests/components/charts/viz.test.tsx`:

```tsx
import { MultiLine } from "@/components/charts/viz/MultiLine";
import { StackedArea } from "@/components/charts/viz/StackedArea";
import { Bar } from "@/components/charts/viz/Bar";

describe("MultiLine viz", () => {
  it("renders one line per series", () => {
    const { container } = render(<MultiLine data={{
      kind: "multiLine",
      series: [
        { key: "a", label: "Alpha", points: [{ day: "2026-05-22", value: 1 }] },
        { key: "b", label: "Beta",  points: [{ day: "2026-05-22", value: 2 }] },
      ],
    }} />);
    expect(container.querySelectorAll(".recharts-line").length).toBe(2);
  });
});

describe("StackedArea viz", () => {
  it("renders", () => {
    const { container } = render(<StackedArea data={{
      kind: "stackedArea",
      series: [{ key: "x", label: "X", points: [{ day: "2026-05-22", value: 1 }] }],
    }} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("Bar viz", () => {
  it("renders", () => {
    const { container } = render(<Bar data={{
      kind: "bar",
      points: [{ day: "2026-05-22", value: 1 }],
    }} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: 3 new failures.

- [ ] **Step 3: Write MultiLine**

```tsx
// src/components/charts/viz/MultiLine.tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

const palette = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

export function MultiLine({ data }: { data: Extract<SeriesData, { kind: "multiLine" }> }) {
  const allDays = Array.from(new Set(data.series.flatMap((s) => s.points.map((p) => p.day)))).sort();
  const rows = allDays.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const s of data.series) row[s.key] = s.points.find((p) => p.day === day)?.value ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {data.series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={palette[i % palette.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Write StackedArea**

```tsx
// src/components/charts/viz/StackedArea.tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

const palette = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

export function StackedArea({ data }: { data: Extract<SeriesData, { kind: "stackedArea" }> }) {
  const allDays = Array.from(new Set(data.series.flatMap((s) => s.points.map((p) => p.day)))).sort();
  const rows = allDays.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const s of data.series) row[s.key] = s.points.find((p) => p.day === day)?.value ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {data.series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stackId="1" stroke={palette[i % palette.length]} fill={palette[i % palette.length]} fillOpacity={0.55} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Write Bar**

```tsx
// src/components/charts/viz/Bar.tsx
"use client";
import { BarChart, Bar as B, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function Bar({ data }: { data: Extract<SeriesData, { kind: "bar" }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <B dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: 5 green.

- [ ] **Step 7: Commit**

```bash
git add src/components/charts/viz/MultiLine.tsx src/components/charts/viz/StackedArea.tsx src/components/charts/viz/Bar.tsx tests/components/charts/viz.test.tsx
git commit -m "feat(charts): MultiLine / StackedArea / Bar viz components"
```

---

## Task 13: viz/Funnel

**Files:**
- Create: `src/components/charts/viz/Funnel.tsx`
- Modify: `tests/components/charts/viz.test.tsx`

- [ ] **Step 1: Add failing test**

```tsx
import { Funnel } from "@/components/charts/viz/Funnel";

describe("Funnel viz", () => {
  it("renders each stage label and value", () => {
    const { getByText } = render(<Funnel data={{
      kind: "funnel",
      stages: [
        { label: "Impressions", value: 1000 },
        { label: "Page views",  value: 200, rate: 0.2 },
        { label: "Sessions",    value: 60,  rate: 0.3 },
        { label: "Downloads",   value: 30,  rate: 0.5 },
      ],
    }} />);
    expect(getByText("Impressions")).not.toBeNull();
    expect(getByText("Downloads")).not.toBeNull();
    expect(getByText("1,000")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx -t Funnel`
Expected: FAIL.

- [ ] **Step 3: Write Funnel**

```tsx
// src/components/charts/viz/Funnel.tsx
"use client";
import type { SeriesData } from "@/lib/dashboards/types";

const fmt = (n: number) => n.toLocaleString();
const pct = (r?: number) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

export function Funnel({ data }: { data: Extract<SeriesData, { kind: "funnel" }> }) {
  const max = Math.max(1, ...data.stages.map((s) => s.value));
  return (
    <div className="flex flex-col gap-2 py-2">
      {data.stages.map((s, i) => {
        const widthPct = Math.max(6, Math.round((s.value / max) * 100));
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-xs text-[var(--ink-2)]">{s.label}</div>
            <div className="relative h-9 flex-1 rounded-md bg-[var(--chart-grid)]">
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-end rounded-md bg-[var(--accent)] pr-2 text-white"
                style={{ width: `${widthPct}%` }}
              >
                <span className="num text-xs font-semibold">{fmt(s.value)}</span>
              </div>
            </div>
            <div className="w-14 shrink-0 text-right text-xs text-[var(--ink-2)]">
              {i === 0 ? "" : pct(s.rate)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx -t Funnel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/viz/Funnel.tsx tests/components/charts/viz.test.tsx
git commit -m "feat(charts): Funnel viz with conversion rates"
```

---

## Task 14: viz/SmallMultiples + viz/Heatmap

**Files:**
- Create: `src/components/charts/viz/SmallMultiples.tsx`
- Create: `src/components/charts/viz/Heatmap.tsx`
- Modify: `tests/components/charts/viz.test.tsx`

- [ ] **Step 1: Add failing tests**

```tsx
import { SmallMultiples } from "@/components/charts/viz/SmallMultiples";
import { Heatmap } from "@/components/charts/viz/Heatmap";

describe("SmallMultiples viz", () => {
  it("renders one tile per series", () => {
    const { container } = render(<SmallMultiples data={{
      kind: "smallMultiples",
      series: [
        { key: "a", label: "Alpha", points: [{ day: "2026-05-22", value: 1 }] },
        { key: "b", label: "Beta",  points: [{ day: "2026-05-22", value: 2 }] },
      ],
    }} />);
    expect(container.querySelectorAll("[data-mini-tile]").length).toBe(2);
  });
});

describe("Heatmap viz", () => {
  it("renders a cell per day", () => {
    const points = Array.from({ length: 21 }, (_, i) => ({
      day: `2026-05-${String(i + 1).padStart(2, "0")}`, value: i,
    }));
    const { container } = render(<Heatmap data={{ kind: "heatmap", points }} />);
    expect(container.querySelectorAll("[data-heatmap-cell]").length).toBe(21);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: 2 new failures.

- [ ] **Step 3: Write SmallMultiples**

```tsx
// src/components/charts/viz/SmallMultiples.tsx
"use client";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function SmallMultiples({ data }: { data: Extract<SeriesData, { kind: "smallMultiples" }> }) {
  const sharedMax = Math.max(1, ...data.series.flatMap((s) => s.points.map((p) => p.value)));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.series.map((s) => (
        <div key={s.key} data-mini-tile className="rounded-lg bg-[var(--glass)] p-2">
          <div className="mb-1 truncate text-[11px] text-[var(--ink-2)]">{s.label}</div>
          <div className="num text-lg font-semibold">{s.points.at(-1)?.value.toLocaleString() ?? "—"}</div>
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={s.points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <YAxis hide domain={[0, sharedMax]} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} fill="var(--accent)" fillOpacity={0.18} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write Heatmap**

```tsx
// src/components/charts/viz/Heatmap.tsx
"use client";
import type { SeriesData } from "@/lib/dashboards/types";

export function Heatmap({ data }: { data: Extract<SeriesData, { kind: "heatmap" }> }) {
  if (data.points.length === 0) return <div className="text-sm text-[var(--ink-2)]">No data</div>;
  const sorted = [...data.points].sort((a, b) => a.day.localeCompare(b.day));
  const max = Math.max(1, ...sorted.map((p) => p.value));
  const cells: { day: string; value: number; row: number; col: number }[] = [];
  let col = -1, lastWeek = "";
  for (const p of sorted) {
    const d = new Date(p.day + "T00:00:00Z");
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow);
    const weekKey = monday.toISOString().slice(0, 10);
    if (weekKey !== lastWeek) { col++; lastWeek = weekKey; }
    cells.push({ day: p.day, value: p.value, row: dow, col });
  }
  const size = 12, gap = 2;
  const width = (col + 1) * (size + gap);
  const height = 7 * (size + gap);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Calendar heatmap">
      {cells.map((c) => {
        const opacity = 0.15 + 0.85 * (c.value / max);
        return (
          <rect
            key={c.day}
            data-heatmap-cell
            x={c.col * (size + gap)}
            y={c.row * (size + gap)}
            width={size} height={size} rx={2}
            fill="var(--accent)" fillOpacity={opacity}
          >
            <title>{`${c.day}: ${c.value.toLocaleString()}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/components/charts/viz.test.tsx`
Expected: 8 green.

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/viz/SmallMultiples.tsx src/components/charts/viz/Heatmap.tsx tests/components/charts/viz.test.tsx
git commit -m "feat(charts): SmallMultiples grid + calendar Heatmap"
```

---

## Task 15: VizRenderer

**Files:**
- Create: `src/components/charts/viz/VizRenderer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/charts/viz/VizRenderer.tsx
"use client";
import { Area } from "./Area";
import { MultiLine } from "./MultiLine";
import { StackedArea } from "./StackedArea";
import { Bar } from "./Bar";
import { Funnel } from "./Funnel";
import { SmallMultiples } from "./SmallMultiples";
import { Heatmap } from "./Heatmap";
import type { SeriesData } from "@/lib/dashboards/types";

export function VizRenderer({ data }: { data: SeriesData }) {
  switch (data.kind) {
    case "area": return <Area data={data} />;
    case "multiLine": return <MultiLine data={data} />;
    case "stackedArea": return <StackedArea data={data} />;
    case "bar": return <Bar data={data} />;
    case "funnel": return <Funnel data={data} />;
    case "smallMultiples": return <SmallMultiples data={data} />;
    case "heatmap": return <Heatmap data={data} />;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: clean (exhaustive switch).

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/viz/VizRenderer.tsx
git commit -m "feat(charts): VizRenderer dispatches by SeriesData.kind"
```

---

## Task 16: ChartCardFrame

**Files:**
- Create: `src/components/dashboard/ChartCardFrame.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/ChartCardFrame.tsx
"use client";
import { Card } from "@/components/glass/Card";
import { VizRenderer } from "@/components/charts/viz/VizRenderer";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import type { ChartCard, Range } from "@/lib/dashboards/types";
import { useMemo, useState } from "react";

const RANGES: Range[] = ["7d", "30d", "90d", "mtd", "ytd", "all"];

export function ChartCardFrame({
  card, raw, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  card: ChartCard;
  raw: RawBundle;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [range, setRange] = useState<Range>(card.range);
  const [compare, setCompare] = useState(card.compare === "prevPeriod");
  const series = useMemo(
    () => buildSeries({ ...card, range, compare: compare ? "prevPeriod" : "none" }, raw),
    [card, raw, range, compare],
  );
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{card.title}</h3>
        <div className="flex items-center gap-1">
          <button aria-label="Move up" onClick={onMoveUp} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-2)] hover:bg-[var(--chart-grid)]">↑</button>
          <button aria-label="Move down" onClick={onMoveDown} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-2)] hover:bg-[var(--chart-grid)]">↓</button>
          <button aria-label="Edit" onClick={onEdit} className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--chart-grid)]">✎</button>
          <button aria-label="Delete" onClick={onDelete} className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--chart-grid)]">🗑</button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[var(--chart-grid)] text-xs">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-1 ${range === r ? "bg-[var(--accent)] text-white" : "text-[var(--ink-2)] hover:bg-[var(--chart-grid)]"}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        {(card.viz === "area" || card.viz === "bar") && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            vs. previous period
          </label>
        )}
      </div>
      <VizRenderer data={series} />
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ChartCardFrame.tsx
git commit -m "feat(dashboard): ChartCardFrame with inline range chips + compare toggle"
```

---

## Task 17: CardEditor

**Files:**
- Create: `src/components/dashboard/CardEditor.tsx`
- Test: `tests/components/dashboard/card-editor.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// tests/components/dashboard/card-editor.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CardEditor } from "@/components/dashboard/CardEditor";
import type { ChartCard } from "@/lib/dashboards/types";
import type { RawBundle } from "@/lib/aggregate/series";

const card: ChartCard = {
  id: "c1", title: "T", metric: "downloads", viz: "area",
  appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none",
};
const raw: RawBundle = {
  apps: { "1": { name: "Alpha" } },
  sales: { "1": [{ day: "2026-05-22", byCountry: { US: 4 }, total: 4, redownloads: 0, proceedsUsd: 0 }] },
  analytics: { "1": [] }, ratings: { "1": [] }, reviews: { "1": [] }, keywords: { "1": [] },
  today: "2026-05-22",
};

describe("CardEditor", () => {
  it("calls onSave with the edited card", () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <CardEditor card={card} raw={raw} apps={[{ id: "1", name: "Alpha" }]} dashboardId="app:1"
        onSave={onSave} onCancel={() => {}} />
    );
    fireEvent.change(getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(getByText(/save/i));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed" }));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/components/dashboard/card-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the component**

```tsx
// src/components/dashboard/CardEditor.tsx
"use client";
import { useState, useMemo } from "react";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import { VizRenderer } from "@/components/charts/viz/VizRenderer";
import { vizForMetric, breakdownForMetric } from "@/lib/dashboards/compatibility";
import type { ChartCard, Metric, Viz, Breakdown, Bucket, Range } from "@/lib/dashboards/types";

const METRICS: { group: string; items: { id: Metric; label: string }[] }[] = [
  { group: "Acquisition", items: [
    { id: "downloads", label: "Downloads" }, { id: "redownloads", label: "Redownloads" },
    { id: "impressions", label: "Impressions" }, { id: "pageViews", label: "Page views" },
  ]},
  { group: "Engagement", items: [
    { id: "sessions", label: "Sessions" }, { id: "activeDevices", label: "Active devices" },
    { id: "deletions", label: "Deletions" },
  ]},
  { group: "Quality", items: [
    { id: "crashes", label: "Crashes" }, { id: "avgRating", label: "Avg rating" },
    { id: "ratingsCount", label: "Ratings count" }, { id: "reviewCount", label: "Review count" },
    { id: "responseRate", label: "Response rate" },
  ]},
  { group: "Money", items: [{ id: "proceedsUsd", label: "Proceeds (USD)" }]},
  { group: "Derived", items: [
    { id: "convPageToInstall", label: "Page → install conv" },
    { id: "convImpressionToPage", label: "Impression → page conv" },
  ]},
  { group: "Keywords", items: [{ id: "keywordRank", label: "Keyword rank" }]},
];

const ALL_VIZ: Viz[] = ["area", "multiLine", "stackedArea", "bar", "funnel", "smallMultiples", "heatmap"];

export function CardEditor({
  card, raw, apps, dashboardId, onSave, onCancel,
}: {
  card: ChartCard;
  raw: RawBundle;
  apps: { id: string; name: string }[];
  dashboardId: string;
  onSave: (c: ChartCard) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ChartCard>(card);
  const isGlance = dashboardId === "glance";

  const compatibleViz = useMemo(() => {
    const set = new Set<Viz>(vizForMetric(draft.metric));
    set.add("funnel");
    return ALL_VIZ.filter((v) => set.has(v));
  }, [draft.metric]);

  const compatibleBreakdowns = useMemo(() => breakdownForMetric(draft.metric), [draft.metric]);
  const preview = useMemo(() => buildSeries(draft, raw), [draft, raw]);

  function update<K extends keyof ChartCard>(k: K, v: ChartCard[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[min(420px,100%)] flex-col gap-3 overflow-y-auto border-l border-[var(--glass-br)] bg-[var(--glass)] p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Edit chart</h2>
        <button onClick={onCancel} aria-label="Close" className="text-sm text-[var(--ink-2)]">✕</button>
      </div>

      <label className="text-xs text-[var(--ink-2)]">
        Title
        <input
          aria-label="Title"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Metric
        <select
          aria-label="Metric"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.metric}
          onChange={(e) => update("metric", e.target.value as Metric)}
        >
          {METRICS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Visualization
        <select
          aria-label="Visualization"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.viz}
          onChange={(e) => update("viz", e.target.value as Viz)}
        >
          {compatibleViz.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>

      {isGlance && (
        <fieldset className="text-xs text-[var(--ink-2)]">
          <legend>Apps</legend>
          <label className="mt-1 flex items-center gap-1.5">
            <input type="radio" checked={draft.appIds === "all"} onChange={() => update("appIds", "all")} /> All apps
          </label>
          <label className="mt-1 flex items-center gap-1.5">
            <input type="radio" checked={draft.appIds !== "all"} onChange={() => update("appIds", [apps[0]?.id ?? ""])} /> Pick…
          </label>
          {draft.appIds !== "all" && (
            <div className="mt-1 flex flex-wrap gap-1">
              {apps.map((a) => {
                const selected = (draft.appIds as string[]).includes(a.id);
                return (
                  <button type="button" key={a.id}
                    className={`rounded-full border px-2 py-0.5 text-xs ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--chart-grid)]"}`}
                    onClick={() => {
                      const cur = draft.appIds as string[];
                      update("appIds", selected ? cur.filter((x) => x !== a.id) : [...cur, a.id]);
                    }}>
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      <label className="text-xs text-[var(--ink-2)]">
        Breakdown
        <select
          aria-label="Breakdown"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.breakdown}
          onChange={(e) => update("breakdown", e.target.value as Breakdown)}
        >
          {compatibleBreakdowns.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Bucket
        <select
          aria-label="Bucket"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.bucket}
          onChange={(e) => update("bucket", e.target.value as Bucket)}
        >
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Range
        <select
          aria-label="Range"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.range}
          onChange={(e) => update("range", e.target.value as Range)}
        >
          {["7d","30d","90d","mtd","ytd","all"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      {draft.metric === "keywordRank" && (
        <label className="text-xs text-[var(--ink-2)]">
          Keyword term
          <input
            aria-label="Keyword term"
            className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
            value={draft.keywordTerm ?? ""}
            onChange={(e) => update("keywordTerm", e.target.value)}
          />
        </label>
      )}

      <div className="rounded-lg border border-[var(--chart-grid)] p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Preview</div>
        <VizRenderer data={preview} />
      </div>

      <div className="mt-auto flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-md border border-[var(--chart-grid)] px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={() => onSave(draft)} className="flex-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white">Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/components/dashboard/card-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/CardEditor.tsx tests/components/dashboard/card-editor.test.tsx
git commit -m "feat(dashboard): CardEditor slide-over with live preview"
```

---

## Task 18: ConfigurableDashboard

**Files:**
- Create: `src/components/dashboard/ConfigurableDashboard.tsx`
- Test: `tests/components/dashboard/configurable-dashboard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// tests/components/dashboard/configurable-dashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ConfigurableDashboard } from "@/components/dashboard/ConfigurableDashboard";
import type { DashboardSlice } from "@/lib/dashboards/types";
import type { RawBundle } from "@/lib/aggregate/series";

const slice: DashboardSlice = {
  cards: [
    { id: "c1", title: "First",  metric: "downloads", viz: "area", appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none" },
    { id: "c2", title: "Second", metric: "downloads", viz: "area", appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none" },
  ],
  updatedAt: "2026-05-22T00:00:00Z",
};
const raw: RawBundle = {
  apps: { "1": { name: "Alpha" } },
  sales: { "1": [{ day: "2026-05-22", byCountry: { US: 4 }, total: 4, redownloads: 0, proceedsUsd: 0 }] },
  analytics: { "1": [] }, ratings: { "1": [] }, reviews: { "1": [] }, keywords: { "1": [] },
  today: "2026-05-22",
};

describe("ConfigurableDashboard", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ updatedAt: "x" }), { status: 200 }));
  });

  it("renders one card per slice entry", () => {
    const { getByText } = render(
      <ConfigurableDashboard id="app:1" initial={slice} raw={raw} apps={[{ id: "1", name: "Alpha" }]} />
    );
    expect(getByText("First")).not.toBeNull();
    expect(getByText("Second")).not.toBeNull();
  });

  it("posts to /api/dashboards/app:1 after delete", async () => {
    const { getAllByLabelText } = render(
      <ConfigurableDashboard id="app:1" initial={slice} raw={raw} apps={[{ id: "1", name: "Alpha" }]} />
    );
    fireEvent.click(getAllByLabelText("Delete")[0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dashboards/app:1",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/components/dashboard/configurable-dashboard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the component**

```tsx
// src/components/dashboard/ConfigurableDashboard.tsx
"use client";
import { useState, useCallback } from "react";
import { ChartCardFrame } from "./ChartCardFrame";
import { CardEditor } from "./CardEditor";
import type { ChartCard, DashboardSlice } from "@/lib/dashboards/types";
import type { RawBundle } from "@/lib/aggregate/series";

function uuid(): string { return crypto.randomUUID(); }

export function ConfigurableDashboard({
  id, initial, raw, apps,
}: {
  id: string;
  initial: DashboardSlice;
  raw: RawBundle;
  apps: { id: string; name: string }[];
}) {
  const [cards, setCards] = useState<ChartCard[]>(initial.cards);
  const [editing, setEditing] = useState<ChartCard | null>(null);

  const persist = useCallback((next: ChartCard[]) => {
    setCards(next);
    void fetch(`/api/dashboards/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards: next, updatedAt: new Date().toISOString() }),
    });
  }, [id]);

  const onSave = (c: ChartCard) => {
    const exists = cards.find((x) => x.id === c.id);
    const next = exists ? cards.map((x) => x.id === c.id ? c : x) : [...cards, c];
    persist(next);
    setEditing(null);
  };

  const onAdd = () => {
    const isGlance = id === "glance";
    const draft: ChartCard = {
      id: uuid(), title: "New chart", metric: "downloads", viz: "area",
      appIds: isGlance ? "all" : [id.replace(/^app:/, "")],
      range: "30d", bucket: "day", breakdown: "none", compare: "none",
    };
    setEditing(draft);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[idx], next[j]] = [next[j], next[idx]];
    persist(next);
  };

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Charts</h2>
        <button onClick={onAdd} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white">
          + Add chart
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c, i) => (
          <ChartCardFrame
            key={c.id}
            card={c}
            raw={raw}
            onEdit={() => setEditing(c)}
            onDelete={() => persist(cards.filter((x) => x.id !== c.id))}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, +1)}
          />
        ))}
      </div>
      {editing && (
        <CardEditor
          card={editing}
          raw={raw}
          apps={apps}
          dashboardId={id}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/components/dashboard/configurable-dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ConfigurableDashboard.tsx tests/components/dashboard/configurable-dashboard.test.tsx
git commit -m "feat(dashboard): ConfigurableDashboard grid + add/reorder/delete + persist"
```

---

## Task 19: API route GET/POST

**Files:**
- Create: `src/app/api/dashboards/[id]/route.ts`
- Test: `tests/app/dashboards-route.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/app/dashboards-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => ({ user: { name: "operator" } })),
}));

const storeJson: { value: { byId: Record<string, unknown> } } = { value: { byId: {} } };
vi.mock("@/lib/store/store", () => ({
  ghBackendFromEnv: () => ({}),
  makeStore: () => ({
    readJson: async () => storeJson.value,
    writeJson: async (_p: string, v: unknown) => { storeJson.value = v as typeof storeJson.value; },
  }),
}));

import { GET, POST } from "@/app/api/dashboards/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/dashboards/[id]", () => {
  beforeEach(() => { storeJson.value = { byId: {} }; });

  it("GET returns defaults for glance when missing", async () => {
    const res = await GET(new Request("http://x"), ctx("glance"));
    const body = await res.json();
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards.length).toBe(4);
  });

  it("POST writes a valid slice and returns updatedAt", async () => {
    const body = {
      cards: [{
        id: "c1", title: "T", metric: "downloads", viz: "area", appIds: "all",
        range: "7d", bucket: "day", breakdown: "none", compare: "none",
      }],
      updatedAt: new Date().toISOString(),
    };
    const res = await POST(new Request("http://x", {
      method: "POST", body: JSON.stringify(body),
    }), ctx("glance"));
    expect(res.status).toBe(200);
    expect(storeJson.value.byId["glance"]).toBeDefined();
  });

  it("POST rejects an invalid body with 400", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST", body: JSON.stringify({ cards: [{ id: "x" }] }),
    }), ctx("glance"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/app/dashboards-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/dashboards/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { dashboardsPath } from "@/lib/store/paths";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { dashboardSliceSchema } from "@/lib/dashboards/schema";
import type { DashboardsFile } from "@/lib/dashboards/types";

type Ctx = { params: Promise<{ id: string }> };

async function readFile() {
  const store = makeStore(ghBackendFromEnv());
  return await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await readFile();
  const slice = file.byId[id] ?? defaultsFor(id);
  return NextResponse.json(slice);
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = dashboardSliceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.format() }, { status: 400 });

  const store = makeStore(ghBackendFromEnv());
  const file = await readFile();
  const updatedAt = new Date().toISOString();
  const next: DashboardsFile = {
    byId: { ...file.byId, [id]: { cards: parsed.data.cards, updatedAt } },
  };
  await store.writeJson(dashboardsPath(), next, `chore(dashboards): update ${id}`);
  return NextResponse.json({ updatedAt });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm vitest run tests/app/dashboards-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dashboards/[id]/route.ts tests/app/dashboards-route.test.ts
git commit -m "feat(api): GET/POST /api/dashboards/[id] with auth + zod validation"
```

---

## Task 20: Raw-bundle SSR loader + wire Glance page

**Files:**
- Create: `src/lib/aggregate/rawBundle.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write the raw-bundle loader**

```ts
// src/lib/aggregate/rawBundle.ts
import type { Store } from "@/lib/store/store";
import {
  salesPath, analyticsPath, ratingsPath, reviewsPath, keywordsPath, appMetaPath,
  type SalesDay, type AnalyticsDay, type RatingPoint, type Review, type KeywordRank, type AppMeta,
} from "@/lib/store/paths";
import type { RawBundle } from "./series";

function lastNMonths(today: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(today + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7) + "-01");
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export async function loadRawBundle(
  store: Store, appIds: string[], today: string, months: number,
): Promise<RawBundle> {
  const monthStarts = lastNMonths(today, months);
  const apps: RawBundle["apps"] = {};
  const sales: RawBundle["sales"] = {};
  const analytics: RawBundle["analytics"] = {};
  const ratings: RawBundle["ratings"] = {};
  const reviews: RawBundle["reviews"] = {};
  const keywords: RawBundle["keywords"] = {};

  await Promise.all(appIds.map(async (id) => {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    apps[id] = { name: meta?.name ?? id };
    const [s, a, r, k] = await Promise.all([
      Promise.all(monthStarts.map((m) => store.readJson<SalesDay[]>(salesPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<AnalyticsDay[]>(analyticsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<RatingPoint[]>(ratingsPath(id, m), []))),
      Promise.all(monthStarts.map((m) => store.readJson<KeywordRank[]>(keywordsPath(id, m), []))),
    ]);
    sales[id]     = s.flat();
    analytics[id] = a.flat();
    ratings[id]   = r.flat();
    keywords[id]  = k.flat();
    reviews[id]   = await store.readJson<Review[]>(reviewsPath(id), []);
  }));

  return { apps, sales, analytics, ratings, reviews, keywords, today };
}
```

- [ ] **Step 2: Modify Glance page**

In `src/app/page.tsx`, add imports near the top:

```ts
import { ConfigurableDashboard } from "@/components/dashboard/ConfigurableDashboard";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { dashboardsPath } from "@/lib/store/paths";
import { loadRawBundle } from "@/lib/aggregate/rawBundle";
import type { DashboardsFile } from "@/lib/dashboards/types";
```

Inside the `Glance` async component, after `const g = await buildGlance(...)`, add:

```ts
  const dashboards = await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
  const glanceSlice = dashboards.byId["glance"] ?? defaultsFor("glance");
  const raw = await loadRawBundle(store, ids, todayUtc(), 4); // 4 months covers 90d
  const apps = ids.map((id) => ({ id, name: raw.apps[id]?.name ?? id }));
```

Just before the closing tag of the page's JSX, render:

```tsx
      <ConfigurableDashboard id="glance" initial={glanceSlice} raw={raw} apps={apps} />
```

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/aggregate/rawBundle.ts src/app/page.tsx
git commit -m "feat(glance): wire ConfigurableDashboard + raw bundle loader"
```

---

## Task 21: Wire per-app page + delete LineArea

**Files:**
- Modify: `src/app/app/[appId]/page.tsx`
- Delete: `src/components/charts/LineArea.tsx`
- Delete: `tests/components/linearea.test.tsx`

- [ ] **Step 1: Replace per-app page body**

Replace the entire file `src/app/app/[appId]/page.tsx` with:

```tsx
import { Nav } from "@/components/glass/Nav";
import { ConfigurableDashboard } from "@/components/dashboard/ConfigurableDashboard";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { appMetaPath, dashboardsPath, type AppMeta } from "@/lib/store/paths";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { loadRawBundle } from "@/lib/aggregate/rawBundle";
import { todayUtc } from "@/lib/dates";
import type { DashboardsFile } from "@/lib/dashboards/types";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const store = makeStore(ghBackendFromEnv());
  const meta = await store.readJson<AppMeta | null>(appMetaPath(appId), null);
  const dashboards = await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
  const slice = dashboards.byId[`app:${appId}`] ?? defaultsFor(`app:${appId}`);
  const raw = await loadRawBundle(store, [appId], todayUtc(), 4);
  const apps = [{ id: appId, name: meta?.name ?? appId }];
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{meta?.name ?? appId}</h1>
      <ConfigurableDashboard id={`app:${appId}`} initial={slice} raw={raw} apps={apps} />
    </main>
  );
}
```

- [ ] **Step 2: Delete old chart + test**

```bash
git rm src/components/charts/LineArea.tsx tests/components/linearea.test.tsx
```

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: all green. If any other test imports `LineArea`, fix the import.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/[appId]/page.tsx
git commit -m "feat(app-detail): replace LineArea with ConfigurableDashboard"
```

---

## Task 22: E2E smoke + push + PR

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Bound to http://localhost:3000.

- [ ] **Step 2: Smoke checks (manual)**

- Visit `/` — see KPI tiles + four default Glance charts (downloads multi-line, acquisition funnel, active devices stacked, avg rating multi-line).
- Click `+ Add chart` — slide-over opens; metric/viz changes update preview without a network call.
- Save — new card appears; verify POST to `/api/dashboards/glance` (200) in DevTools Network.
- Visit `/app/<appId>` — see four default per-app charts (area with compare overlay, funnel, source breakdown, heatmap).
- Use range chips on a card — chart re-renders client-side, no network call.
- Reload — saved cards persist.
- ↑ / ↓ reorder a card; reload — order persists.
- 🗑 delete a card; reload — still gone.

Fix any failures; rerun `pnpm test` and `pnpm build` until both green.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/configurable-charts
```

- [ ] **Step 4: Open PR**

Use `gh pr create` per repo convention. Suggested title: `feat: configurable charts on Glance + per-app`. Body should link the spec at `docs/superpowers/specs/2026-05-24-configurable-charts-design.md`.
