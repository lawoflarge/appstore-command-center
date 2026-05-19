// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
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

import { LineArea } from "@/components/charts/LineArea";

test("LineArea renders an svg for given points", () => {
  const { container } = render(<LineArea data={[{ day: "2026-05-18", value: 5 }, { day: "2026-05-19", value: 8 }]} />);
  expect(container.querySelector("svg")).toBeTruthy();
});
