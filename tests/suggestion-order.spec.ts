import { expect, test } from "@playwright/test";
import { nextSuggestionIndex } from "../src/crossword/suggestionOrder";

test("letter diversity stays within confirmed and score priorities", () => {
  const candidates = [
    { word: "ABE", confirmed: true, score: 3 },
    { word: "AND", confirmed: true, score: 3 },
    { word: "BIL", confirmed: true, score: 2 },
    { word: "BUS", confirmed: false, score: 3 },
  ];
  const samePriority = (a: typeof candidates[number], b: typeof candidates[number]) => a.confirmed === b.confirmed && a.score === b.score;
  expect(nextSuggestionIndex(candidates, 1, new Set(["A"]), false, samePriority)).toBe(1);
  candidates.splice(2, 0, { word: "BÅD", confirmed: true, score: 3 });
  expect(nextSuggestionIndex(candidates, 1, new Set(["A"]), false, samePriority)).toBe(2);
  expect(nextSuggestionIndex(candidates, 1, new Set(["A"]), true, samePriority)).toBe(1);
});
