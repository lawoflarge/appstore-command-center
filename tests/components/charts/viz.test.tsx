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
import { MultiLine } from "@/components/charts/viz/MultiLine";
import { StackedArea } from "@/components/charts/viz/StackedArea";
import { Bar } from "@/components/charts/viz/Bar";

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
