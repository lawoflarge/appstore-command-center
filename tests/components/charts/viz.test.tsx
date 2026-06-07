// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      actual.ResponsiveContainer
        ? <div style={{ width: 400, height: 220 }}><actual.ResponsiveContainer width={400} height={220}>{children}</actual.ResponsiveContainer></div>
        : <div>{children}</div>,
  };
});

import { Area } from "@/components/charts/viz/Area";
import { MultiLine, multiLineRows } from "@/components/charts/viz/MultiLine";
import { StackedArea } from "@/components/charts/viz/StackedArea";
import { Bar } from "@/components/charts/viz/Bar";
import { Funnel } from "@/components/charts/viz/Funnel";
import { SmallMultiples } from "@/components/charts/viz/SmallMultiples";
import { Heatmap } from "@/components/charts/viz/Heatmap";

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
        points: [{ day: "2026-05-21", value: 8 }, { day: "2026-05-22", value: 10 }],
        compare: [{ day: "2026-05-21", value: 4 }, { day: "2026-05-22", value: 5 }],
      }} />
    );
    expect(container.querySelectorAll("path").length).toBeGreaterThan(1);
  });
});

describe("MultiLine viz", () => {
  it("renders one line per series", () => {
    const { container } = render(<MultiLine data={{
      kind: "multiLine",
      series: [
        { key: "a", label: "Alpha", points: [{ day: "2026-05-21", value: 1 }, { day: "2026-05-22", value: 2 }] },
        { key: "b", label: "Beta",  points: [{ day: "2026-05-21", value: 3 }, { day: "2026-05-22", value: 4 }] },
      ],
    }} />);
    expect(container.querySelectorAll(".recharts-line").length).toBe(2);
  });

  it("aligns rows with null (a gap), not 0, for a day a series lacks — no false cliff to zero", () => {
    const rows = multiLineRows([
      { key: "a", label: "Alpha", points: [{ day: "2026-06-05", value: 3 }, { day: "2026-06-06", value: 2 }] },
      { key: "b", label: "Beta",  points: [{ day: "2026-06-05", value: 4 }] }, // no 2026-06-06 row
    ]);
    const jun6 = rows.find((r) => r.day === "2026-06-06")!;
    expect(jun6.a).toBe(2);
    expect(jun6.b).toBeNull(); // NOT 0 — a missing day must be a gap, not a plunge to zero
  });
});

describe("StackedArea viz", () => {
  it("renders", () => {
    const { container } = render(<StackedArea data={{
      kind: "stackedArea",
      series: [{ key: "x", label: "X", points: [{ day: "2026-05-21", value: 1 }, { day: "2026-05-22", value: 2 }] }],
    }} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("Bar viz", () => {
  it("renders", () => {
    const { container } = render(<Bar data={{
      kind: "bar",
      points: [{ day: "2026-05-21", value: 1 }, { day: "2026-05-22", value: 2 }],
    }} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

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

describe("SmallMultiples viz", () => {
  it("renders one tile per series", () => {
    const { container } = render(<SmallMultiples data={{
      kind: "smallMultiples",
      series: [
        { key: "a", label: "Alpha", points: [{ day: "2026-05-21", value: 1 }, { day: "2026-05-22", value: 2 }] },
        { key: "b", label: "Beta",  points: [{ day: "2026-05-21", value: 3 }, { day: "2026-05-22", value: 4 }] },
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
