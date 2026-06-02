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
