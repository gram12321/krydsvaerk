import { answerLetters } from "./layout";

/** Prefer an unrepresented initial only within the current priority group. */
export function nextSuggestionIndex<T extends { word: string }>(candidates: readonly T[], start: number, initials: ReadonlySet<string>, firstLetterFixed: boolean, samePriority: (a: T, b: T) => boolean): number {
  if (!firstLetterFixed && initials.size) {
    for (let i = start; i < candidates.length; i++) {
      if (!samePriority(candidates[start], candidates[i])) break;
      if (!initials.has(answerLetters(candidates[i].word)[0])) return i;
    }
  }
  return start;
}
