// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      <div style={{ width: 400, height: 220 }}><actual.ResponsiveContainer width={400} height={220}>{children}</actual.ResponsiveContainer></div>,
  };
});

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
  sales: { "1": [
    { day: "2026-05-21", byCountry: { US: 3 }, total: 3, redownloads: 0, proceedsUsd: 0 },
    { day: "2026-05-22", byCountry: { US: 4 }, total: 4, redownloads: 0, proceedsUsd: 0 },
  ]},
  analytics: { "1": [] }, ratings: { "1": [] }, reviews: { "1": [] }, keywords: { "1": [] },
  today: "2026-05-22",
};

describe("ConfigurableDashboard", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ updatedAt: "x" }), { status: 200 })) as unknown as typeof fetch;
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
