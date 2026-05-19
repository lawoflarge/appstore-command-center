import { test, expect } from "vitest";
import { attentionScore, rankPortfolio } from "@/lib/aggregate/portfolio";

test("attentionScore weights anomaly drop + rating drop + unresponded", () => {
  const s = attentionScore({ anomalyDrop: true, ratingDelta: -0.2, unresponded: 3 });
  expect(s).toBeGreaterThan(0);
});

test("rankPortfolio sorts highest attention first", () => {
  const rows = rankPortfolio([
    { appId: "1", name: "A", score: 2 },
    { appId: "2", name: "B", score: 9 },
  ]);
  expect(rows[0].appId).toBe("2");
});
