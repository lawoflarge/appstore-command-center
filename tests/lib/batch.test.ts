import { test, expect } from "vitest";
import { chunk, selectRoundRobinBatch } from "@/lib/batch";

test("chunk splits into bounded slices, last one short", () => {
  expect(chunk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
});

test("chunk handles empty + degenerate size", () => {
  expect(chunk([], 4)).toEqual([]);
  expect(chunk([1, 2], 0)).toEqual([[1, 2]]); // size<=0 never loops forever — one slice
});

test("selectRoundRobinBatch sweeps every app across consecutive runs, stable order", () => {
  const ids = ["c", "a", "b", "d", "e"]; // unsorted on purpose
  // sorted: a b c d e ; batchSize 2 → 3 batches
  expect(selectRoundRobinBatch(ids, 2, 0)).toEqual(["a", "b"]);
  expect(selectRoundRobinBatch(ids, 2, 1)).toEqual(["c", "d"]);
  expect(selectRoundRobinBatch(ids, 2, 2)).toEqual(["e"]);
  // union of one full cycle covers the whole portfolio
  const cycle = [0, 1, 2].flatMap((i) => selectRoundRobinBatch(ids, 2, i));
  expect([...cycle].sort()).toEqual(["a", "b", "c", "d", "e"]);
});

test("selectRoundRobinBatch wraps and tolerates negative / fractional runIndex", () => {
  const ids = ["a", "b", "c", "d", "e"];
  expect(selectRoundRobinBatch(ids, 2, 3)).toEqual(["a", "b"]); // 3 % 3 = 0
  expect(selectRoundRobinBatch(ids, 2, -1)).toEqual(["e"]);     // ((-1 % 3)+3)%3 = 2
  expect(selectRoundRobinBatch(ids, 2, 1.9)).toEqual(["c", "d"]); // trunc → 1
});

test("selectRoundRobinBatch is empty for empty input or zero batch", () => {
  expect(selectRoundRobinBatch([], 5, 0)).toEqual([]);
  expect(selectRoundRobinBatch(["a"], 0, 0)).toEqual([]);
});
