# Action Feed + Global Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the passive per-app `/insights` page into a severity-ranked, actionable feed driven by a pure `buildActionItems()` transform, surface a "Top 3" block on Glance, and move the Refresh button into the global nav so it appears on every page.

**Architecture:** A new pure function `buildActionItems(insights)` maps the already-stored `Insights` object into a sorted `ActionItem[]` (compute-on-read, no new data flow, no LLM). A shared presentational `ActionCard` renders items in full (Insights) and compact (Glance) variants. The Refresh button moves into `Nav` (a client component already rendered on every page).

**Tech Stack:** Next.js App Router (server components), TypeScript (strict), Vitest + jsdom, Tailwind with "Daylight Frost" glass tokens, pnpm, Node 20.

---

## File Structure

- **Create** `src/lib/intelligence/actions.ts` — pure `buildActionItems()` + `ActionItem`/`Severity`/`ActionKind` types. Single responsibility: signal → ranked actions.
- **Create** `tests/lib/intelligence/actions.test.ts` — unit tests for the transform.
- **Create** `src/components/insights/ActionCard.tsx` — presentational card, `full` + `compact` variants.
- **Create** `tests/components/insights/action-card.test.tsx` — render test.
- **Modify** `src/app/insights/page.tsx` — rebuild as the grouped action feed + forecast context.
- **Modify** `src/app/page.tsx` (Glance) — add "Top 3" block; remove standalone `<RefreshButton />`.
- **Modify** `src/components/glass/Nav.tsx` — add right-aligned `<RefreshButton />`.

Reference types (already exist, do not change):
- `Insights = { generatedAt: string; apps: Record<string, AppInsight> }` — `src/lib/intelligence/engine.ts`
- `AppInsight = { name: string; anomaly: Anomaly | null; funnel: FunnelDiagnosis; opportunities: Opportunity[]; forecast: Forecast }` (note: `appId` is the **key** in `apps`, not a field on `AppInsight`)
- `Anomaly = { appId; metric; day; direction: "spike"|"drop"; z; value; baseline; cause }`
- `FunnelDiagnosis = { leak: "impression_to_pageView"|"pageView_to_install"|"none"; message; rates: { ipv; pvd; baselineIpv; baselinePvd } }`
- `Opportunity = { term; country; rank; trend: "improving"|"declining"|"flat" }`
- `Forecast = { soFar; projected; band: { low; high } }`

---

## Task 1: `buildActionItems` pure transform

**Files:**
- Create: `src/lib/intelligence/actions.ts`
- Test: `tests/lib/intelligence/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/intelligence/actions.test.ts`:

```ts
import { test, expect } from "vitest";
import { buildActionItems } from "@/lib/intelligence/actions";
import type { Insights } from "@/lib/intelligence/engine";

function emptyFunnel() {
  return {
    leak: "none" as const,
    message: "Funnel within normal range.",
    rates: { ipv: 0.3, pvd: 0.1, baselineIpv: 0.3, baselinePvd: 0.1 },
  };
}
function emptyForecast() {
  return { soFar: 0, projected: 0, band: { low: 0, high: 0 } };
}

test("empty insights yields no items", () => {
  const insights: Insights = { generatedAt: "2026-06-01", apps: {} };
  expect(buildActionItems(insights)).toEqual([]);
});

test("drop anomaly becomes a critical item with a release-aware recommendation", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Alpha",
        anomaly: { appId: "1", metric: "downloads", day: "2026-06-01", direction: "drop", z: -3.2, value: 10, baseline: 100, cause: "Near the 1.4 release (2026-05-31)" },
        funnel: emptyFunnel(),
        opportunities: [],
        forecast: emptyForecast(),
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items).toHaveLength(1);
  expect(items[0].kind).toBe("anomaly_drop");
  expect(items[0].severity).toBe("critical");
  expect(items[0].appName).toBe("Alpha");
  expect(items[0].recommendation).toContain("release");
});

test("funnel pvd leak outranks a keyword opportunity which outranks a spike", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "spike": {
        name: "Spiker",
        anomaly: { appId: "spike", metric: "downloads", day: "2026-06-01", direction: "spike", z: 3.0, value: 200, baseline: 100, cause: "Unusual positive movement — check press/feature/ASA" },
        funnel: emptyFunnel(), opportunities: [], forecast: emptyForecast(),
      },
      "leak": {
        name: "Leaker", anomaly: null,
        funnel: { leak: "pageView_to_install", message: "Page-view->install fell.", rates: { ipv: 0.3, pvd: 0.05, baselineIpv: 0.3, baselinePvd: 0.1 } },
        opportunities: [], forecast: emptyForecast(),
      },
      "kw": {
        name: "Worder", anomaly: null, funnel: emptyFunnel(),
        opportunities: [{ term: "diet", country: "us", rank: 9, trend: "declining" }],
        forecast: emptyForecast(),
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items.map((i) => i.kind)).toEqual(["funnel_pvd", "keyword_declining", "anomaly_spike"]);
  expect(items[0].severity).toBe("critical");
  expect(items[1].severity).toBe("opportunity");
  expect(items[2].severity).toBe("good");
});

test("keyword items are capped at 3 per app, highest-ranked first", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Many", anomaly: null, funnel: emptyFunnel(), forecast: emptyForecast(),
        opportunities: [
          { term: "a", country: "us", rank: 25, trend: "declining" },
          { term: "b", country: "us", rank: 20, trend: "declining" },
          { term: "c", country: "us", rank: 15, trend: "declining" },
          { term: "d", country: "us", rank: 9, trend: "declining" },
        ],
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items).toHaveLength(3);
  expect(items.map((i) => i.detail).every((d) => typeof d === "string")).toBe(true);
  // best rank (9) scores highest → first
  expect(items[0].detail).toContain("#9");
});

test("flat keyword trends are not surfaced", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Flat", anomaly: null, funnel: emptyFunnel(), forecast: emptyForecast(),
        opportunities: [{ term: "x", country: "us", rank: 12, trend: "flat" }],
      },
    },
  };
  expect(buildActionItems(insights)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- actions`
Expected: FAIL — "Failed to resolve import @/lib/intelligence/actions".

- [ ] **Step 3: Write the implementation**

Create `src/lib/intelligence/actions.ts`:

```ts
import type { Insights, AppInsight } from "./engine";

export type Severity = "critical" | "opportunity" | "good";
export type ActionKind =
  | "anomaly_drop"
  | "anomaly_spike"
  | "funnel_pvd"
  | "funnel_ipv"
  | "keyword_declining"
  | "keyword_opportunity";

export interface ActionItem {
  appId: string;
  appName: string;
  kind: ActionKind;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  score: number;
}

// Max keyword items emitted per app so one noisy app cannot flood the feed.
const KEYWORD_CAP = 3;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function dropPct(rate: number, baseline: number): number {
  return baseline > 0 ? Math.max(0, (baseline - rate) / baseline) : 0;
}

function appItems(appId: string, a: AppInsight): ActionItem[] {
  const items: ActionItem[] = [];

  // --- Anomalies ---
  if (a.anomaly) {
    const z = Math.abs(a.anomaly.z);
    if (a.anomaly.direction === "drop") {
      const nearRelease = a.anomaly.cause.startsWith("Near the");
      items.push({
        appId, appName: a.name, kind: "anomaly_drop", severity: "critical",
        title: "Downloads dropped sharply",
        detail: `${a.anomaly.value.toLocaleString()} vs a baseline of ${Math.round(a.anomaly.baseline).toLocaleString()}. ${a.anomaly.cause}.`,
        recommendation: nearRelease
          ? "Downloads fell right after a recent release. Diff that release — a regression or store-listing change is the likely cause."
          : "No release nearby. Check App Store availability and look for an external cause (seasonality, a lost feature or ASA campaign).",
        score: 1000 + z * 10,
      });
    } else {
      items.push({
        appId, appName: a.name, kind: "anomaly_spike", severity: "good",
        title: "Downloads spiked",
        detail: `${a.anomaly.value.toLocaleString()} vs a baseline of ${Math.round(a.anomaly.baseline).toLocaleString()}. ${a.anomaly.cause}.`,
        recommendation: "Find what drove it (press, a feature, an ASA campaign) and double down while it lasts.",
        score: 100 + z,
      });
    }
  }

  // --- Funnel leaks ---
  if (a.funnel.leak === "pageView_to_install") {
    const d = dropPct(a.funnel.rates.pvd, a.funnel.rates.baselinePvd);
    items.push({
      appId, appName: a.name, kind: "funnel_pvd", severity: "critical",
      title: "Page views aren't converting to installs",
      detail: `Page-view to install fell to ${pct(a.funnel.rates.pvd)} (was ${pct(a.funnel.rates.baselinePvd)}).`,
      recommendation: "People view the page but don't install. Refresh screenshots/icon or address a low rating.",
      score: 1000 + d * 100,
    });
  } else if (a.funnel.leak === "impression_to_pageView") {
    const d = dropPct(a.funnel.rates.ipv, a.funnel.rates.baselineIpv);
    items.push({
      appId, appName: a.name, kind: "funnel_ipv", severity: "critical",
      title: "Impressions aren't earning page views",
      detail: `Impression to page-view fell to ${pct(a.funnel.rates.ipv)} (was ${pct(a.funnel.rates.baselineIpv)}).`,
      recommendation: "People see you in search/browse but don't tap through. Your icon, title or first screenshot isn't earning the tap.",
      score: 1000 + d * 100 - 1, // ranks just below an equal-magnitude pvd leak
    });
  }

  // --- Keyword moves (cap per app) ---
  const kw = a.opportunities
    .filter((o) => o.trend === "declining" || o.trend === "improving")
    .map<ActionItem>((o) => {
      const declining = o.trend === "declining";
      return {
        appId, appName: a.name,
        kind: declining ? "keyword_declining" : "keyword_opportunity",
        severity: "opportunity",
        title: declining ? `Keyword "${o.term}" is slipping` : `Keyword "${o.term}" is climbing`,
        detail: declining
          ? `${o.term} (${o.country}) is now #${o.rank}.`
          : `${o.term} (${o.country}) is #${o.rank} and climbing.`,
        recommendation: declining
          ? "Refresh your keyword field / metadata to defend the ranking."
          : "Work it into your title/subtitle to push it into the top 10.",
        score: (declining ? 500 : 400) + (26 - o.rank),
      };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, KEYWORD_CAP);
  items.push(...kw);

  return items;
}

export function buildActionItems(insights: Insights): ActionItem[] {
  const out: ActionItem[] = [];
  for (const [appId, a] of Object.entries(insights.apps)) {
    out.push(...appItems(appId, a));
  }
  return out.sort((x, y) => y.score - x.score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- actions`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intelligence/actions.ts tests/lib/intelligence/actions.test.ts
git commit -m "feat(intelligence): buildActionItems — rank signals into action feed"
```

---

## Task 2: `ActionCard` component

**Files:**
- Create: `src/components/insights/ActionCard.tsx`
- Test: `tests/components/insights/action-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/insights/action-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { ActionCard } from "@/components/insights/ActionCard";
import type { ActionItem } from "@/lib/intelligence/actions";

const item: ActionItem = {
  appId: "1", appName: "Alpha", kind: "anomaly_drop", severity: "critical",
  title: "Downloads dropped sharply", detail: "10 vs 100.",
  recommendation: "Diff the recent release.", score: 1032,
};

test("full variant shows title, detail and recommendation", () => {
  const { getByText } = render(<ActionCard item={item} />);
  expect(getByText("Downloads dropped sharply")).toBeTruthy();
  expect(getByText("Diff the recent release.")).toBeTruthy();
  expect(getByText(/Alpha/)).toBeTruthy();
});

test("compact variant shows the title and app name", () => {
  const { getByText, queryByText } = render(<ActionCard item={item} variant="compact" />);
  expect(getByText(/Downloads dropped sharply/)).toBeTruthy();
  // recommendation is hidden in compact mode
  expect(queryByText("Diff the recent release.")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- action-card`
Expected: FAIL — cannot resolve `@/components/insights/ActionCard`.

- [ ] **Step 3: Write the implementation**

Create `src/components/insights/ActionCard.tsx`:

```tsx
import { Card } from "@/components/glass/Card";
import type { ActionItem, Severity } from "@/lib/intelligence/actions";

const COLOR: Record<Severity, string> = {
  critical: "var(--bad)",
  opportunity: "var(--accent)",
  good: "var(--ok)",
};
const LABEL: Record<Severity, string> = {
  critical: "Needs attention",
  opportunity: "Opportunity",
  good: "Good news",
};

export function ActionCard({ item, variant = "full" }: { item: ActionItem; variant?: "full" | "compact" }) {
  const color = COLOR[item.severity];

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 py-1.5 text-sm">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate">
          <span className="font-medium">{item.appName}</span>
          <span className="text-[var(--ink-2)]"> · {item.title}</span>
        </span>
      </div>
    );
  }

  return (
    <Card>
      <div className="border-l-2 pl-3" style={{ borderColor: color }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{item.appName}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
            {LABEL[item.severity]}
          </span>
        </div>
        <div className="mt-1 font-medium">{item.title}</div>
        <div className="mt-0.5 text-sm text-[var(--ink-2)]">{item.detail}</div>
        <div className="mt-2 text-sm" style={{ color }}>→ {item.recommendation}</div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- action-card`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/insights/ActionCard.tsx tests/components/insights/action-card.test.tsx
git commit -m "feat(insights): ActionCard component (full + compact variants)"
```

---

## Task 3: Rebuild the `/insights` page as the action feed

**Files:**
- Modify: `src/app/insights/page.tsx` (full replace)

- [ ] **Step 1: Replace the page**

Replace the entire contents of `src/app/insights/page.tsx` with:

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { ActionCard } from "@/components/insights/ActionCard";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";
import type { Insights, AppInsight } from "@/lib/intelligence/engine";
import { buildActionItems, type ActionItem, type Severity } from "@/lib/intelligence/actions";

export const dynamic = "force-dynamic";

const SECTIONS: { tier: Severity; heading: string }[] = [
  { tier: "critical", heading: "Needs attention" },
  { tier: "opportunity", heading: "Opportunities" },
  { tier: "good", heading: "Good news" },
];

export default async function InsightsPage() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const items = buildActionItems(insights);
  const entries = Object.entries(insights.apps) as [string, AppInsight][];

  const critical = items.filter((i) => i.severity === "critical").length;
  const opportunity = items.filter((i) => i.severity === "opportunity").length;
  const projected = entries.reduce((s, [, a]) => s + (a.forecast?.projected ?? 0), 0);

  const appsWithItems = new Set(items.map((i) => i.appId));
  const allClear = entries.filter(([id]) => !appsWithItems.has(id)).map(([, a]) => a.name);

  const byTier = (tier: Severity): ActionItem[] => items.filter((i) => i.severity === tier);

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Insights</h1>
      <p className="mb-5 text-sm text-[var(--ink-2)]">
        What needs your attention, ranked by urgency. Rules-based signal across the portfolio, regenerated every daily run.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Needs attention</div><div className="num mt-1 text-2xl font-bold">{critical}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Opportunities</div><div className="num mt-1 text-2xl font-bold">{opportunity}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Projected downloads (mo.)</div><div className="num mt-1 text-2xl font-bold">{Math.round(projected).toLocaleString()}</div></Card>
      </div>

      {SECTIONS.map(({ tier, heading }) => {
        const tierItems = byTier(tier);
        if (tierItems.length === 0) return null;
        return (
          <section key={tier} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">{heading}</h2>
            <div className="grid gap-3">
              {tierItems.map((item, i) => (
                <ActionCard key={`${item.appId}-${item.kind}-${i}`} item={item} />
              ))}
            </div>
          </section>
        );
      })}

      {items.length === 0 && entries.length > 0 && (
        <Card>All clear — no signal across {entries.length} app{entries.length === 1 ? "" : "s"} right now.</Card>
      )}

      {items.length > 0 && allClear.length > 0 && (
        <p className="mb-6 text-sm text-[var(--ink-2)]">All clear: {allClear.join(", ")}.</p>
      )}

      {entries.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">Month forecast</h2>
          <div className="grid gap-2">
            {entries.map(([id, a]) => (
              <div key={id} className="flex items-center justify-between rounded-lg bg-[var(--chart-grid)] px-3 py-1.5 text-sm">
                <span>{a.name}</span>
                <span className="num">
                  {Math.round(a.forecast?.projected ?? 0).toLocaleString()}
                  <span className="ml-1 text-xs text-[var(--ink-2)]">({Math.round(a.forecast?.band?.low ?? 0)}–{Math.round(a.forecast?.band?.high ?? 0)})</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {entries.length === 0 && (
        <Card>No insights yet — the first daily run hasn&apos;t produced signal. Trigger <code>/api/cron</code> or wait for 06:00 UTC.</Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify build + lint pass**

Run: `pnpm build`
Expected: build succeeds, no lint/type errors. (No unit test for the page — matches the existing convention where pages are verified via build + browser.)

- [ ] **Step 3: Commit**

```bash
git add src/app/insights/page.tsx
git commit -m "feat(insights): rebuild page as severity-ranked action feed"
```

---

## Task 4: Add "Top 3" action block to Glance

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add imports**

In `src/app/page.tsx`, the existing import `import { runStatusPath, dashboardsPath, type RunStatus } from "@/lib/store/paths";` already pulls from `@/lib/store/paths`. Extend it to include `insightsPath`:

```tsx
import { runStatusPath, dashboardsPath, insightsPath, type RunStatus } from "@/lib/store/paths";
```

Then add these three new imports (anywhere among the existing import block):

```tsx
import type { Insights } from "@/lib/intelligence/engine";
import { buildActionItems } from "@/lib/intelligence/actions";
import { ActionCard } from "@/components/insights/ActionCard";
```

- [ ] **Step 2: Read insights and compute the top 3**

In the `Glance()` function body, after the existing `const raw = await loadRawBundle(...)` line, add:

```tsx
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const topActions = buildActionItems(insights).slice(0, 3);
```

- [ ] **Step 3: Render the block**

In the returned JSX, insert this block immediately after the stats grid `</div>` (the `grid-cols-2 ... sm:grid-cols-4` block) and before the `<div className="mb-2 flex flex-wrap items-center gap-3">` status row:

```tsx
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">Needs your attention</h2>
          <Link href="/insights" className="text-xs text-[var(--accent)] hover:underline">View all →</Link>
        </div>
        {topActions.length > 0 ? (
          <div className="glass divide-y divide-[var(--chart-grid)] px-4 py-1">
            {topActions.map((item, i) => (
              <ActionCard key={`${item.appId}-${item.kind}-${i}`} item={item} variant="compact" />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-2)]">All clear — nothing needs action right now.</p>
        )}
      </div>
```

(`Link` is already imported at the top of the file.)

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: build succeeds, no type/lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(glance): top-3 action block linking to the full feed"
```

---

## Task 5: Move the Refresh button into the global nav

**Files:**
- Modify: `src/components/glass/Nav.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the button to Nav**

In `src/components/glass/Nav.tsx`, add the import at the top (after the `usePathname` import):

```tsx
import { RefreshButton } from "@/components/RefreshButton";
```

Then, inside the `<nav>`, after the closing `})}` of the `items.map(...)` block and before `</nav>`, add:

```tsx
      <span className="ml-auto flex items-center">
        <RefreshButton />
      </span>
```

- [ ] **Step 2: Remove the standalone button from Glance**

In `src/app/page.tsx`:
1. Delete the import line `import { RefreshButton } from "@/components/RefreshButton";`.
2. In the JSX, change the status row from:

```tsx
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <RefreshButton />
        <p className="text-xs text-[var(--muted,#666)]">{lastRunCopy}</p>
      </div>
```

to:

```tsx
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-xs text-[var(--muted,#666)]">{lastRunCopy}</p>
      </div>
```

- [ ] **Step 3: Verify build passes (catches the now-unused import if missed)**

Run: `pnpm build`
Expected: build succeeds. If it fails on an unused `RefreshButton` import in `page.tsx`, remove that import (Step 2.1).

- [ ] **Step 4: Commit**

```bash
git add src/components/glass/Nav.tsx src/app/page.tsx
git commit -m "feat(nav): global Refresh button on every page"
```

---

## Task 6: Full verification + browser check + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (previous ~110 + 7 new = ~117).

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: clean build, no lint/type errors.

- [ ] **Step 3: Browser verification (REQUIRED — do not skip)**

Run `pnpm dev` and open `http://localhost:3000`. Verify visually (screenshot):
- Glance shows the "Needs your attention" block (top-3 compact list or "All clear").
- The Refresh button appears in the nav on Glance, Portfolio, Revenue, ASO, Reviews, Insights, Settings.
- `/insights` shows the grouped feed (Needs attention / Opportunities / Good news), the all-clear line, and the Month forecast section.

Note: on a fresh local checkout most data is empty until prod cron has run, so "All clear" / empty states are expected and acceptable — the goal is to confirm layout renders without errors. If real data is desired, hit the live prod URL after a cron run.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/action-feed-and-global-refresh
```

Then open a PR against `main` titled "feat: action feed + global refresh", body summarizing the three changes (action feed, Glance top-3, global refresh button). Do NOT merge — leave for review.

---

## Self-Review notes

- **Spec coverage:** §1 buildActionItems → Task 1. §2 severity/scoring → Task 1 (scores). §3 templates → Task 1 (inline strings). §4 forecast-as-context → Task 3 (Month forecast section, not an action item). §5 surfaces → Task 3 (insights) + Task 4 (Glance) + Task 2 (shared ActionCard). §6 global refresh → Task 5. Testing → Tasks 1, 2, 6.
- **No deep-link button** on action cards (matches approved spec/YAGNI).
- **Type consistency:** `ActionItem` / `Severity` / `ActionKind` names identical across Tasks 1–4; `buildActionItems(insights: Insights)` signature consistent; `variant` prop `"full" | "compact"` consistent between Task 2 and its consumers.
