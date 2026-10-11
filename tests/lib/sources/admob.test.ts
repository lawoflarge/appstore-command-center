import { describe, it, expect } from "vitest";
import { parseNetworkReport, parseNetworkReportWithCoverage } from "@/lib/sources/admob";

describe("parseNetworkReport", () => {
  it("preserves source currency and reporting timezone for complete-day forecasts", () => {
    const rows = parseNetworkReport([
      { header: { reportingTimeZone: "Europe/Berlin", localizationSettings: { currencyCode: "EUR" } } },
      { row: { dimensionValues: { DATE: { value: "20261010" } }, metricValues: { ESTIMATED_EARNINGS: { microsValue: "1000000" } } } },
    ]);
    expect(rows[0]).toMatchObject({ reportingTimeZone: "Europe/Berlin", currencyCode: "EUR", earnings: 1 });
  });

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

describe("AdMob report coverage", () => {
  const header = {
    dateRange: { startDate: { year: 2026, month: 10, day: 1 }, endDate: { year: 2026, month: 10, day: 10 } },
    reportingTimeZone: "Europe/Berlin", localizationSettings: { currencyCode: "EUR" },
  };
  it("includes quiet days after the last activity but excludes the account's current day", () => {
    const report = parseNetworkReportWithCoverage([
      { header },
      { row: { dimensionValues: { DATE: { value: "20261006" } }, metricValues: { ESTIMATED_EARNINGS: { microsValue: "9000000" } } } },
      { footer: { matchingRowCount: "1" } },
    ], "2026-10-10T12:00:00Z");
    expect(report.rows[0].day).toBe("2026-10-06");
    expect(report.coverage).toMatchObject({ startDay: "2026-10-01", endDay: "2026-10-10", completeThroughDay: "2026-10-09" });
  });
  it("confirms a valid empty report's coverage without inventing an ad unit", () => {
    const report = parseNetworkReportWithCoverage([{ header }, { footer: { matchingRowCount: "0" } }], "2026-10-10T12:00:00Z");
    expect(report.rows).toEqual([]);
    expect(report.coverage.completeThroughDay).toBe("2026-10-09");
  });
  it("uses the report timezone at collection time and never extends beyond the request", () => {
    const parts = [{ header }, { footer: {} }];
    expect(parseNetworkReportWithCoverage(parts, "2026-10-09T22:30:00Z").coverage.completeThroughDay).toBe("2026-10-09");
    expect(parseNetworkReportWithCoverage(parts, "2026-10-12T12:00:00Z").coverage.completeThroughDay).toBe("2026-10-10");
  });
  it("rejects delayed, malformed and wrong-currency coverage", () => {
    expect(() => parseNetworkReportWithCoverage([{ header }, { footer: { warnings: [{ type: "DATA_DELAYED" }] } }])).toThrow("warnings");
    expect(() => parseNetworkReportWithCoverage([{ header: { ...header, localizationSettings: { currencyCode: "USD" } } }, { footer: {} }])).toThrow("EUR");
    expect(() => parseNetworkReportWithCoverage([{ header: { ...header, dateRange: {} } }, { footer: {} }])).toThrow("date range");
    expect(() => parseNetworkReportWithCoverage([{ header }])).toThrow("coverage");
  });
  it("uses a freshly fetched account timezone when Google omits its default from the header", () => {
    const parts = [{ header: { ...header, reportingTimeZone: undefined } }, { footer: { matchingRowCount: "0" } }];
    expect(() => parseNetworkReportWithCoverage(parts)).toThrow("timezone");
    expect(parseNetworkReportWithCoverage(parts, "2026-10-09T22:30:00Z", { reportingTimeZone: "Europe/Berlin" }).coverage.completeThroughDay).toBe("2026-10-09");
  });
  it("does not confirm more matched rows than received or malformed monetary metrics", () => {
    expect(() => parseNetworkReportWithCoverage([{ header }, { footer: { matchingRowCount: "1" } }])).toThrow("row coverage");
    const row = { dimensionValues: { DATE: { value: "20261006" } }, metricValues: { ESTIMATED_EARNINGS: { microsValue: "NaN" } } };
    expect(() => parseNetworkReportWithCoverage([{ header }, { row }, { footer: { matchingRowCount: "1" } }])).toThrow("metric");
  });
});
