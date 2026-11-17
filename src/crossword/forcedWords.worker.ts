import { createFillCache, fillLayout } from "./fillLayout";
import { type DictionaryEntry } from "./dictionary";
import { answerLetters, fitsBreaks, wordCells, type GridLayout } from "./layout";

self.onmessage = (event: MessageEvent<{ layout: GridLayout; entries: DictionaryEntry[]; letters: Record<string, string>; forcedWords: DictionaryEntry[] }>) => {
  const { layout, entries, letters, forcedWords } = event.data;
  const required = forcedWords.map(entry => entry.word);
  const cache = createFillCache(entries, new Set(layout.words.map(word => word.length)));
  const placements: { id: string; entry: DictionaryEntry }[] = [];
  const unavailable: string[] = [];
  const unresolved: string[] = [];
  for (const entry of forcedWords) {
    const candidates = layout.words.filter(word => word.length === answerLetters(entry.word).length && fitsBreaks(word, entry.word)
      && wordCells(word).every((cell, i) => !letters[`${cell.row},${cell.col}`] || letters[`${cell.row},${cell.col}`] === answerLetters(entry.word)[i]));
    const possible: typeof candidates = [];
    let uncertain = false;
    for (const word of candidates) {
      const fixed = { ...letters };
      wordCells(word).forEach((cell, i) => { fixed[`${cell.row},${cell.col}`] = answerLetters(entry.word)[i]; });
      const result = fillLayout(layout, entries, 10000, fixed, false, undefined, cache, required);
      if (result.status === "solved") possible.push(word);
      else if (result.status === "limit" || result.status === "invalid") uncertain = true;
      if (possible.length > 1) break;
    }
    if (!uncertain && possible.length === 1) placements.push({ id: possible[0].id, entry });
    if (!possible.length && !uncertain) unavailable.push(entry.word);
    if (uncertain && possible.length < 2) unresolved.push(entry.word);
  }
  self.postMessage({ placements, unavailable, unresolved });
};
