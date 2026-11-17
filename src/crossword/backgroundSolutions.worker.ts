import { createFillCache, fillLayout } from "./fillLayout";
import { indexWordScores, isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";
import { answerLetters, fitsBreaks, wordCells, type GridLayout } from "./layout";
import { nextSuggestionIndex } from "./suggestionOrder";

self.onmessage = async (event: MessageEvent<{ layout: GridLayout; entries: DictionaryEntry[]; letters: Record<string, string>; knownSolutions?: Record<string, DictionaryEntry>[] }>) => {
  const { layout, entries, letters, knownSolutions = [] } = event.data;
  const cache = createFillCache(entries, new Set(layout.words.map(word => word.length)));
  const scores = indexWordScores(entries);
  const known = layout.words.map(() => new Set<string>());
  const remember = (answers: Record<string, DictionaryEntry>) => layout.words.forEach((word, i) => {
    if (answers[word.id]) known[i].add(answers[word.id].word);
  });
  knownSolutions.forEach(remember);
  const uniqueEntries = [...new Map(entries.filter(entry => isValidAnswerSpelling(entry.word)).map(entry => [entry.word, entry])).values()];
  const slots = layout.words.map(word => {
    const cells = wordCells(word);
    const candidates = uniqueEntries.filter(entry => answerLetters(entry.word).length === word.length && fitsBreaks(word, entry.word)
      && cells.every((cell, i) => !letters[`${cell.row},${cell.col}`] || letters[`${cell.row},${cell.col}`] === answerLetters(entry.word)[i]))
      .sort((a, b) => (scores.get(b.word) ?? 0) - (scores.get(a.word) ?? 0) || a.word.localeCompare(b.word, "da"));
    return { cells, candidates, cursor: 0, deferred: [] as DictionaryEntry[], budget: 3000, firstLetterFixed: Boolean(letters[`${cells[0].row},${cells[0].col}`]) };
  });
  if (!slots.length) { self.postMessage({ type: "done", reason: "invalid" }); return; }
  let rotation = 0;
  let turn = 0;
  const lastVisited = slots.map(() => -1);
  while (true) {
    const available = slots.map((slot, i) => ({ slot, i })).filter(({ slot }) => slot.cursor < slot.candidates.length || slot.deferred.length > 0);
    if (!available.length) { self.postMessage({ type: "done", reason: "complete" }); return; }
    // Reserve every fourth check for round-robin progress so difficult slots
    // receive priority without preventing the rest of the grid from advancing.
    const index = turn % 4 === 3
      ? available.reduce((best, item) => (item.i - rotation + slots.length) % slots.length < (best.i - rotation + slots.length) % slots.length ? item : best).i
      : available.reduce((best, item) => known[item.i].size < known[best.i].size || (known[item.i].size === known[best.i].size && lastVisited[item.i] < lastVisited[best.i]) ? item : best).i;
    rotation = (index + 1) % slots.length;
    lastVisited[index] = turn++;
    const slot = slots[index];
    if (slot.cursor >= slot.candidates.length && slot.deferred.length) {
      slot.candidates = slot.deferred;
      slot.deferred = [];
      slot.cursor = 0;
      slot.budget = Math.min(slot.budget * 2, 24000);
    }
    if (slot.cursor < slot.candidates.length) {
      const initials = new Set([...known[index]].map(word => answerLetters(word)[0]));
      const next = nextSuggestionIndex(slot.candidates, slot.cursor, initials, slot.firstLetterFixed);
      [slot.candidates[slot.cursor], slot.candidates[next]] = [slot.candidates[next], slot.candidates[slot.cursor]];
    }
    let skipped = 0;
    while (slot.cursor < slot.candidates.length && known[index].has(slot.candidates[slot.cursor].word) && skipped < 100) { slot.cursor++; skipped++; }
    if (slot.cursor < slot.candidates.length && !known[index].has(slot.candidates[slot.cursor].word)) {
      const entry = slot.candidates[slot.cursor++];
      const fixed = { ...letters };
      slot.cells.forEach((cell, i) => { fixed[`${cell.row},${cell.col}`] = answerLetters(entry.word)[i]; });
      const result = fillLayout(layout, entries, slot.budget, fixed, false, undefined, cache);
      if (result.status === "invalid") { self.postMessage({ type: "done", reason: "invalid" }); return; }
      if (result.status === "limit") slot.deferred.push(entry);
      if (result.status === "solved") { remember(result.answers); self.postMessage({ type: "solution", answers: result.answers }); }
    }
    if (slots.every(item => item.cursor >= item.candidates.length && item.deferred.length === 0)) {
      self.postMessage({ type: "done", reason: "complete" });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
};
