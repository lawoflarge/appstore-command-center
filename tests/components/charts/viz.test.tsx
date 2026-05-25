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
