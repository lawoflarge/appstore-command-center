// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      <div style={{ width: 400, height: 220 }}><actual.ResponsiveContainer width={400} height={220}>{children}</actual.ResponsiveContainer></div>,
  };
});

import { CardEditor } from "@/components/dashboard/CardEditor";
import type { ChartCard } from "@/lib/dashboards/types";
import type { RawBundle } from "@/lib/aggregate/series";

const card: ChartCard = {
  id: "c1", title: "T", metric: "downloads", viz: "area",
  appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none",
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
