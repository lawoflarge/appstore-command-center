import { describe, it, expect } from "vitest";
import { parseNetworkReport } from "@/lib/sources/admob";

describe("parseNetworkReport", () => {
  it("maps rows, converts micros to currency, and derives eCPM", () => {
    const parts = [
      { header: { dateRange: {} } },
      {
        row: {
          dimensionValues: {
            DATE: { value: "20260528" },
            APP: { value: "ca-app-pub-1~2", displayLabel: "Titi & Bina: Pixel Run" },
            AD_UNIT: { value: "ca-app-pub-1/3", displayLabel: "Continue Revive" },
          },
          metricValues: {
            ESTIMATED_EARNINGS: { microsValue: "70000" }, // 0.07
            IMPRESSIONS: { integerValue: "2" },
            CLICKS: { integerValue: "0" },
            AD_REQUESTS: { integerValue: "6" },
            MATCHED_REQUESTS: { integerValue: "6" },
          },
        },
      },
      { footer: { matchingRowCount: "1" } },
    ];

    const rows = parseNetworkReport(parts);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.day).toBe("2026-05-28");
    expect(r.app).toBe("Titi & Bina: Pixel Run");
    expect(r.adUnit).toBe("Continue Revive");
    expect(r.earnings).toBeCloseTo(0.07, 5);
    expect(r.impressions).toBe(2);
    expect(r.requests).toBe(6);
    expect(r.ecpm).toBeCloseTo(35, 5); // 0.07 / 2 * 1000
  });

  it("skips header/footer parts and zero-impression rows get eCPM 0", () => {
    const parts = [
      { header: {} },
      {
        row: {
          dimensionValues: { DATE: { value: "20260527" }, APP: { value: "x" }, AD_UNIT: { value: "y" } },
          metricValues: { ESTIMATED_EARNINGS: { microsValue: "0" }, IMPRESSIONS: { integerValue: "0" } },
        },
      },
    ];
    const rows = parseNetworkReport(parts);
    expect(rows).toHaveLength(1);
    expect(rows[0].ecpm).toBe(0);
    expect(rows[0].app).toBe("x"); // falls back to value when no displayLabel
  });
});
