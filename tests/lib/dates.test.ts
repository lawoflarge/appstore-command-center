import { test, expect } from "vitest";
import { ymd, addDays, dayRange, rowsInMonth } from "@/lib/dates";

test("ymd formats a UTC date", () => {
  expect(ymd(new Date("2026-05-19T23:30:00Z"))).toBe("2026-05-19");
});

test("addDays crosses month boundary in UTC", () => {
  expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  expect(addDays("2026-05-01", -1)).toBe("2026-04-30");
});

test("dayRange is inclusive and ordered", () => {
  expect(dayRange("2026-05-18", "2026-05-20")).toEqual([
    "2026-05-18",
    "2026-05-19",
    "2026-05-20",
  ]);
});

test("rowsInMonth keeps only rows whose day is in the file's month (drops cross-month rows)", () => {
  // Apple's rolling analytics window can spill late-May rows into the June file. When reading a
  // month file, keep only its own month so a day never appears twice across files.
  const rows = [
    { day: "2026-05-31", v: 1 },
    { day: "2026-06-01", v: 2 },
    { day: "2026-06-06", v: 3 },
  ];
  expect(rowsInMonth(rows, "2026-06-01").map((r) => r.day)).toEqual(["2026-06-01", "2026-06-06"]);
  expect(rowsInMonth(rows, "2026-05-01").map((r) => r.day)).toEqual(["2026-05-31"]);
  expect(rowsInMonth([], "2026-06-01")).toEqual([]);
});
