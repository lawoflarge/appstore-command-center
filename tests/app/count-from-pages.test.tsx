// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SalesDay } from "@/lib/store/paths";

// Page wiring of the countFrom cutoff (app transfer, lib/countFrom.ts): app "200" was transferred
// in on 2026-10-05, app "100" is our own. Each page must drop "200"'s earlier rows and keep "100"
// whole, so these tests fail if a page stops reading the cutoff or stops applying it.
const { records } = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/glass/Nav", () => ({ Nav: () => <nav>Navigation</nav> }));
vi.mock("@/lib/store/store", () => ({
  ghBackendFromEnv: () => ({}),
  makeStore: () => ({ readJson: async (path: string, fallback: unknown) => records.get(path) ?? fallback }),
}));
vi.mock("@/lib/aggregate/api", () => ({ visibleAppIds: async () => ["100", "200"] }));
vi.mock("@/components/revenue/IapCharts", () => ({
  IapCharts: (props: unknown) => <output data-testid="iap-chart">{JSON.stringify(props)}</output>,
}));
vi.mock("@/components/revenue/RevenueCharts", () => ({ RevenueCharts: () => null }));
vi.mock("@/components/revenue/MonthlyRevenueOverview", () => ({
  MonthlyRevenueOverview: ({ revenue }: { revenue: unknown }) => <output data-testid="monthly">{JSON.stringify(revenue)}</output>,
}));

import RevenuePage from "@/app/revenue/page";
import ReviewsPage from "@/app/reviews/page";
import AsoPage from "@/app/aso/page";

const CUTOFF = "2026-10-05";
function sale(day: string, proceeds: number): SalesDay {
  return {
    day, total: 0, redownloads: 0, byCountry: {}, proceedsUsd: proceeds, proceedsEur: proceeds,
    proceedsByCcy: { EUR: proceeds }, reportAvailable: true, proceedsEurByType: { oneTime: proceeds, subscription: 0, other: 0 },
  };
}
const review = (id: string, title: string, createdDate: string) =>
  ({ id, rating: 5, title, body: "", reviewer: "", territory: "USA", createdDate, responded: false });
const product = (appAppleId: string, appName: string) => ({
  appName, appAppleId, subscriptionName: `${appName} Weekly`, subscriptionAppleId: `${appAppleId}9`, subscriptionGroupId: "1",
  duration: "1 Week", counts: { standardPrice: 1, freeTrial: 0, paidOffer: 0, marketingOptIn: 0, gracePeriod: 0, billingRetry: 0 },
});

beforeEach(() => {
  records.clear();
  vi.setSystemTime(new Date("2026-10-10T19:00:00Z"));
  records.set("data/config.json", { apps: { "200": { hidden: false, archived: false, keywords: [], countFrom: CUTOFF } } });
  records.set("data/100/meta.json", { name: "Own App" });
  records.set("data/200/meta.json", { name: "Transferred App" });
});
afterEach(() => vi.useRealTimers());

it("revenue page counts a transferred app's proceeds and subscription stock only from its countFrom", async () => {
  records.set("data/100/sales/2026-10.json", [sale("2026-10-03", 3)]);
  records.set("data/200/sales/2026-10.json", [sale("2026-10-03", 50), sale("2026-10-06", 7)]);
  records.set("data/subscriptions/latest.json", {
    reportDate: "2026-10-04", collectedAt: "2026-10-05T00:00:00Z", source: "SUBSCRIPTION/SUMMARY 1_3",
    products: [product("100", "Own App"), product("200", "Transferred App")],
  });
  render(await RevenuePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("IAP & subs total", { exact: true }).parentElement).toHaveTextContent("10.00 EUR");
  const iap = JSON.parse(screen.getByTestId("iap-chart").textContent!);
  expect(iap.byApp).toEqual([{ appId: "200", name: "Transferred App", proceeds: 7 }, { appId: "100", name: "Own App", proceeds: 3 }]);
  const monthly = JSON.parse(screen.getByTestId("monthly").textContent!);
  expect(monthly.byApp.map((a: { appId: string; total: number }) => [a.appId, a.total])).toEqual([["200", 7], ["100", 3]]);
  // The stock snapshot predates the cutoff, so the transferred app's subscribers are not shown.
  expect(screen.getByText("Own App Weekly", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("Transferred App Weekly", { exact: false })).toBeNull();
});

it("reviews page hides a transferred app's reviews from before its countFrom", async () => {
  records.set("data/100/reviews.json", [review("a", "Own old review", "2026-09-01T10:00:00-07:00")]);
  records.set("data/200/reviews.json", [
    review("b", "Previous owner review", "2026-10-04T10:00:00-07:00"),
    review("c", "Post transfer review", "2026-10-05T08:00:00-07:00"),
  ]);
  render(await ReviewsPage());
  expect(screen.getByText("Own old review")).toBeInTheDocument();
  expect(screen.getByText("Post transfer review")).toBeInTheDocument();
  expect(screen.queryByText("Previous owner review")).toBeNull();
});

it("ASO page ignores a transferred app's keyword ranks from before its countFrom", async () => {
  records.set("data/100/keywords/2026-10.json", [{ day: "2026-10-01", term: "own term", country: "us", rank: 4 }]);
  records.set("data/200/keywords/2026-10.json", [
    { day: "2026-10-04", term: "old owner term", country: "us", rank: 1 },
    { day: "2026-10-06", term: "new term", country: "us", rank: 5 },
  ]);
  render(await AsoPage());
  expect(screen.getByText("own term")).toBeInTheDocument();
  expect(screen.getByText("new term")).toBeInTheDocument();
  expect(screen.queryByText("old owner term")).toBeNull();
});

it("revenue page does not let a transferred app awaiting its first report block the Apple forecast", async () => {
  records.set("data/100/sales/2026-10.json", [sale("2026-10-08", 8)]);
  render(await RevenuePage({ searchParams: Promise.resolve({}) }));
  const monthly = JSON.parse(screen.getByTestId("monthly").textContent!);
  expect(monthly.forecast).toMatchObject({ appleThrough: "2026-10-08", appleDays: 8 });
});
