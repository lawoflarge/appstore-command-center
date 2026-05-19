import { test, expect } from "vitest";
import { salesPath, reviewsPath, ratingsPath, keywordsPath, configPath, insightsPath, runStatusPath, appMetaPath } from "@/lib/store/paths";

test("monthly partition paths", () => {
  expect(salesPath("123", "2026-05-19")).toBe("data/123/sales/2026-05.json");
  expect(ratingsPath("123", "2026-05-19")).toBe("data/123/ratings/2026-05.json");
  expect(reviewsPath("123")).toBe("data/123/reviews.json");
  expect(keywordsPath("123", "2026-05-19")).toBe("data/123/keywords/2026-05.json");
  expect(appMetaPath("123")).toBe("data/123/meta.json");
  expect(configPath()).toBe("data/config.json");
  expect(insightsPath()).toBe("data/insights.json");
  expect(runStatusPath()).toBe("data/run-status.json");
});
