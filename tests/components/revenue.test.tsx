// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SalesDay, SubscriptionSnapshot } from "@/lib/store/paths";
import { buildMonthlyRevenue } from "@/lib/aggregate/revenue-monthly";

const { replace, records } = vi.hoisted(() => ({ replace: vi.fn(), records: new Map<string, unknown>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/glass/Nav", () => ({ Nav: () => <nav>Navigation</nav> }));
vi.mock("@/lib/store/store", () => ({
  ghBackendFromEnv: () => ({}),
  makeStore: () => ({ readJson: async (path: string, fallback: unknown) => records.get(path) ?? fallback }),
}));
vi.mock("@/lib/aggregate/api", () => ({ visibleAppIds: async () => ["123"] }));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    <actual.ResponsiveContainer width={400} height={230}>{children}</actual.ResponsiveContainer> };
});

import { MonthlyRevenueOverview } from "@/components/revenue/MonthlyRevenueOverview";
import { ActiveSubscriptions } from "@/components/revenue/ActiveSubscriptions";
import RevenuePage from "@/app/revenue/page";

function sale(day: string, proceeds: number): SalesDay {
  return {
    day, total: 0, redownloads: 0, byCountry: {}, proceedsUsd: proceeds,
    proceedsEur: proceeds, proceedsByCcy: { EUR: proceeds }, reportAvailable: true,
    proceedsEurByType: { oneTime: proceeds, subscription: 0, other: 0 },
  };
}

beforeEach(() => {
  replace.mockClear(); records.clear();
  vi.setSystemTime(new Date("2026-10-10T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("monthly revenue", () => {
  it("changes the month through the URL without changing other dashboard state", () => {
    const revenue = buildMonthlyRevenue([], [], "2026-10", "2026-10-10");
    render(<MonthlyRevenueOverview revenue={revenue} months={["2026-10", "2026-09"]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Revenue month" }), { target: { value: "2026-09" } });
    expect(replace).toHaveBeenCalledWith("/revenue?month=2026-09", { scroll: false });
  });

  it("keeps unclassified Apple revenue visible without fabricating category amounts", () => {
    const row = sale("2026-10-09", 12);
    delete row.proceedsEurByType;
    const revenue = buildMonthlyRevenue([{ appId: "123", name: "Test App", sales: [row] }], [], "2026-10", "2026-10-10");
    render(<MonthlyRevenueOverview revenue={revenue} months={["2026-10"]} />);
    expect(screen.getByText("€12.00")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.getByText(/cannot yet be assigned/)).toBeInTheDocument();
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0);
  });

  it("uses the selected historical month for the total and Apple breakdown and preserves refunds", async () => {
    records.set("data/123/meta.json", { name: "Refund App" });
    records.set("data/123/sales/2026-09.json", [sale("2026-09-29", -3)]);
    records.set("data/123/sales/2026-10.json", [sale("2026-10-09", 40)]);
    render(await RevenuePage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
    const month = screen.getByRole("region", { name: "September 2026" });
    expect(within(month).getAllByText("-€3.00").length).toBeGreaterThan(0);
    expect(within(month).queryByText(/month-end estimate/i)).not.toBeInTheDocument();
    const apple = screen.getByRole("region", { name: "Apple proceeds by app" });
    expect(within(apple).getByRole("rowheader", { name: "Refund App" })).toBeInTheDocument();
    expect(within(apple).getAllByText("-€3.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("€40.00")).not.toBeInTheDocument();
  });

  it("falls back to the current month for an unavailable query value", async () => {
    render(await RevenuePage({ searchParams: Promise.resolve({ month: "2030-01" }) }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Revenue month" })).toHaveValue("2026-10");
    expect(screen.getByText("No revenue reports are available for this month yet.")).toBeInTheDocument();
  });
});

describe("active subscriptions", () => {
  it("shows an absent snapshot as unknown, not zero active subscriptions", () => {
    render(<ActiveSubscriptions snapshot={null} />);
    expect(screen.getByText("No subscription snapshot available yet")).toBeInTheDocument();
    expect(screen.queryByText("Paid subscriptions")).not.toBeInTheDocument();
  });

  it("shows the report date and keeps billing recovery separate from paid counts", () => {
    const snapshot: SubscriptionSnapshot = {
      reportDate: "2026-10-08", collectedAt: "2026-10-10T19:00:00Z", source: "SUBSCRIPTION/SUMMARY 1_3",
      products: [{ appAppleId: "123", appName: "Test App", subscriptionAppleId: "456", subscriptionName: "Pro Monthly", subscriptionGroupId: "789", duration: "1 Month", counts: { standardPrice: 4, paidOffer: 2, freeTrial: 3, gracePeriod: 1, billingRetry: 2, marketingOptIn: 1 } }],
    };
    render(<ActiveSubscriptions snapshot={snapshot} />);
    expect(screen.getByText("As of 8 October 2026")).toBeInTheDocument();
    expect(screen.getByText("Paid subscriptions").parentElement).toHaveTextContent("6");
    expect(screen.getByRole("rowheader", { name: /Test App Pro Monthly/ })).toBeInTheDocument();
    expect(screen.getByText(/not individual subscribers/)).toBeInTheDocument();
  });
});


it("uses fresh confirmed ad coverage for quiet dates and a verified zero month", async () => {
  records.set("data/admob/report-coverage.json", {
    startDay: "2026-09-01", endDay: "2026-10-09", completeThroughDay: "2026-10-09",
    reportingTimeZone: "Europe/Berlin", currencyCode: "EUR", collectedAt: "2026-10-10T12:00:00Z",
  });
  render(await RevenuePage({}));
  const month = screen.getByRole("region", { name: "October 2026" });
  expect(within(month).getByText("AdMob ads").parentElement?.parentElement).toHaveTextContent("€0.00");
  expect(screen.queryByText(/AdMob reports have not updated/)).not.toBeInTheDocument();
});
