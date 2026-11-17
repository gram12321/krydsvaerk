import { answerLetters } from "./layout";

/** Prefer an unrepresented initial while leaving every candidate in the queue. */
export function nextSuggestionIndex<T extends { word: string }>(candidates: readonly T[], start: number, initials: ReadonlySet<string>, firstLetterFixed: boolean): number {
  if (!firstLetterFixed && initials.size) {
    for (let i = start; i < candidates.length; i++) {
      if (!initials.has(answerLetters(candidates[i].word)[0])) return i;
    }
  }
  return start;
}
