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
