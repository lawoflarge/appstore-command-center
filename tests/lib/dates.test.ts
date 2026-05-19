import { test, expect } from "vitest";
import { ymd, addDays, dayRange } from "@/lib/dates";

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
