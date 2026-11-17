import { fillLayout } from "./fillLayout";
import { answerLetters, entryMatchesWordCue, fitsBreaks, wordCells, type GridLayout } from "./layout";
import { getEntryScore, indexWordScores, isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";
import { nextSuggestionIndex } from "./suggestionOrder";

self.onmessage = (event: MessageEvent<{ layout: GridLayout; entries: DictionaryEntry[]; solverEntries: DictionaryEntry[]; selected: string; letters: Record<string, string>; requiredWords?: string[]; knownSolutions?: Record<string, DictionaryEntry>[]; unsatisfiableCandidates?: string[] }>) => {
  const { layout, entries, solverEntries, selected, letters, requiredWords = [], knownSolutions = [], unsatisfiableCandidates = [] } = event.data;
  const slot = layout.words.find(word => word.id === selected);
  if (!slot) return;
  const cells = wordCells(slot);
  const matching = entries.filter(entry => entryMatchesWordCue(layout, slot, entry) && answerLetters(entry.word).length === slot.length && isValidAnswerSpelling(entry.word) && fitsBreaks(slot, entry.word) && cells.every((cell, i) => !letters[`${cell.row},${cell.col}`] || letters[`${cell.row},${cell.col}`] === answerLetters(entry.word)[i]));
  const scores = indexWordScores(entries);
  const knownByWord = new Map<string, Record<string, DictionaryEntry>[]>();
  for (const answers of knownSolutions) {
    const word = answers[selected]?.word;
    if (word) knownByWord.set(word, [...(knownByWord.get(word) ?? []), answers]);
  }
  const candidates = [...new Map([...matching].reverse().map(entry => [entry.word, entry])).values()]
    .sort((a, b) => Number(knownByWord.has(b.word)) - Number(knownByWord.has(a.word)) || (scores.get(b.word) ?? 0) - (scores.get(a.word) ?? 0) || a.word.localeCompare(b.word, "da"));
  const rejected = new Set(unsatisfiableCandidates);
  const solverWords = new Set(solverEntries.map(entry => entry.word));
  const compatible = (answers: Record<string, DictionaryEntry>) => {
    if (!requiredWords.every(word => Object.values(answers).some(entry => entry.word === word))) return false;
    const assignments = new Map<string, string>();
    for (const word of layout.words) {
      const answer = answers[word.id]?.word;
      const entry = answers[word.id];
      if (!answer || (word.id !== selected && !solverWords.has(answer)) || answerLetters(answer).length !== word.length || !fitsBreaks(word, answer) || !entryMatchesWordCue(layout, word, entry)) return false;
      wordCells(word).forEach((cell, i) => assignments.set(`${cell.row},${cell.col}`, answerLetters(answer)[i]));
    }
    return Object.entries(letters).every(([cell, letter]) => !letter || assignments.get(cell) === letter);
  };
  let checked = 0, uncertain = 0, found = 0;
  const initials = new Set<string>();
  const firstLetterFixed = Boolean(letters[`${cells[0].row},${cells[0].col}`]);
  const rejectedResults: string[] = [];
  for (let position = 0; position < candidates.length; position++) {
    const next = nextSuggestionIndex(candidates, position, initials, firstLetterFixed, (a, b) =>
      knownByWord.has(a.word) === knownByWord.has(b.word) && (scores.get(a.word) ?? 0) === (scores.get(b.word) ?? 0));
    if (next !== position) candidates.splice(position, 0, candidates.splice(next, 1)[0]);
    const entry = candidates[position];
    const fixed = { ...letters };
    cells.forEach((cell, i) => { fixed[`${cell.row},${cell.col}`] = answerLetters(entry.word)[i]; });
    // The selected suggestion is available for its own slot; every crossing
    // slot must also be fillable from the same enabled dictionaries.
    const witness = knownByWord.get(entry.word)?.find(compatible);
    const result = witness ? { status: "solved" as const, answers: witness } : rejected.has(entry.word) ? { status: "unsatisfiable" as const } : fillLayout(layout, [...solverEntries, entry], 3000, fixed, false, undefined, undefined, requiredWords);
    checked++;
    if (result.status === "solved") {
      found++;
      initials.add(answerLetters(entry.word)[0]);
      const cluesByText = new Map<string, { clue: string; score: number }>();
      for (const item of matching.filter(item => item.word === entry.word)) {
        const clue = item.clue.trim();
        const key = clue.toLocaleLowerCase("da-DK");
        const current = cluesByText.get(key);
        const score = getEntryScore(item);
        if (!current || score > current.score) cluesByText.set(key, { clue, score });
      }
      const clues = [...cluesByText.values()].sort((a, b) => b.score - a.score || a.clue.localeCompare(b.clue, "da"));
      self.postMessage({ type: "candidate", entry, clues, answers: result.answers });
    }
    if (result.status === "limit") uncertain++;
    if (result.status === "unsatisfiable") { rejectedResults.push(entry.word); self.postMessage({ type: "rejected", word: entry.word }); }
    self.postMessage({ type: "progress", checked, total: candidates.length, uncertain });
    if (found >= 40) break;
  }
  self.postMessage({ type: "done", checked, total: candidates.length, uncertain, found, unsatisfiableCandidates: rejectedResults });
};
