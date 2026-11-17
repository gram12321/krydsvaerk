import { createFillCache, fillLayout } from "./fillLayout";
import { indexWordScores, isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";
import { answerLetters, fitsBreaks, wordCells, type GridLayout } from "./layout";

self.onmessage = (event: MessageEvent<{ layout: GridLayout; entries: DictionaryEntry[]; letters: Record<string, string>; selected?: string; checkOnly?: boolean; knownSolutions?: { answers: Record<string, DictionaryEntry> }[]; unsatisfiableCandidates?: string[] }>) => {
  const { layout, entries, letters, selected, checkOnly, knownSolutions = [], unsatisfiableCandidates = [] } = event.data;
  let lastUpdate = 0;
  const report = (data: object, force = false) => {
    const now = Date.now();
    if (force || now - lastUpdate >= 250) { lastUpdate = now; self.postMessage({ type: "progress", ...data }); }
  };
  if (!selected) {
    const mode = checkOnly ? "check" : "grid";
    let latest: object = { mode, nodes: 0, solutions: 0, bestScore: null };
    const result = fillLayout(layout, entries, 100000, letters, !checkOnly, progress => { latest = { mode, ...progress }; report(latest); });
    report(latest, true);
    self.postMessage(checkOnly
      ? { type: "checked", status: result.status, errors: result.status === "invalid" ? result.errors : undefined, searchStats: latest }
      : result);
    return;
  }
  const slot = layout.words.find(word => word.id === selected);
  if (!slot) return;
  const cells = wordCells(slot);
  const compatibleSolutions = knownSolutions.filter(solution => {
    const assignments = new Map<string, string>();
    for (const word of layout.words) {
      const answer = solution.answers[word.id]?.word;
      if (!answer || answerLetters(answer).length !== word.length || !fitsBreaks(word, answer)) return false;
      wordCells(word).forEach((cell, i) => assignments.set(`${cell.row},${cell.col}`, answerLetters(answer)[i]));
    }
    return Object.entries(letters).every(([cell, letter]) => !letter || assignments.get(cell) === letter);
  });
  const unsatisfiable = new Set(unsatisfiableCandidates);
  const previouslySolvedWords = new Set(compatibleSolutions
    .map(solution => solution.answers[selected]?.word)
    .filter((word): word is string => !!word));
  const scores = indexWordScores(entries);
  const candidates = [...new Map(entries.filter(entry => answerLetters(entry.word).length === slot.length && isValidAnswerSpelling(entry.word) && fitsBreaks(slot, entry.word) && cells.every((cell, i) => !letters[`${cell.row},${cell.col}`] || letters[`${cell.row},${cell.col}`] === answerLetters(entry.word)[i])).map(entry => [entry.word, entry])).values()]
    .sort((a, b) => Number(previouslySolvedWords.has(b.word)) - Number(previouslySolvedWords.has(a.word))
      || (scores.get(b.word) ?? 0) - (scores.get(a.word) ?? 0)
      || a.word.localeCompare(b.word, "da"));
  let checked = 0, uncertain = 0, attemptNodes = 0;
  const cache = createFillCache(entries, new Set(layout.words.map(word => word.length)));
  report({ mode: "word", checked, total: candidates.length, uncertain, nodes: 0 }, true);
  for (const entry of candidates) {
    if (unsatisfiable.has(entry.word)) { checked++; continue; }
    const reused = compatibleSolutions.find(solution => solution.answers[selected]?.word === entry.word);
    if (reused) {
      checked++;
      report({ mode: "word", checked, total: candidates.length, uncertain, nodes: 0 }, true);
      self.postMessage({ status: uncertain ? "limit" : "solved", answers: { [selected]: reused.answers[selected] }, searchStats: { checked, total: candidates.length, uncertain, nodes: 0, reused: true } });
      return;
    }
    const fixed = { ...letters };
    cells.forEach((cell, i) => { fixed[`${cell.row},${cell.col}`] = answerLetters(entry.word)[i]; });
    attemptNodes = 0;
    const result = fillLayout(layout, entries, 10000, fixed, false, progress => { attemptNodes = progress.nodes; report({ mode: "word", checked, total: candidates.length, uncertain, nodes: attemptNodes }); }, cache);
    checked++;
    if (result.status === "invalid") { self.postMessage({ ...result, searchStats: { checked, total: candidates.length, uncertain, nodes: attemptNodes } }); return; }
    if (result.status === "limit") uncertain++;
    if (result.status === "solved") { report({ mode: "word", checked, total: candidates.length, uncertain, nodes: attemptNodes }, true); self.postMessage({ status: uncertain ? "limit" : "solved", answers: { [selected]: entry }, searchStats: { checked, total: candidates.length, uncertain, nodes: attemptNodes } }); return; }
    report({ mode: "word", checked, total: candidates.length, uncertain, nodes: attemptNodes }, true);
    if (uncertain >= 10) { self.postMessage({ status: "limit", searchStats: { checked, total: candidates.length, uncertain, nodes: attemptNodes } }); return; }
  }
  self.postMessage({ status: uncertain ? "limit" : "unsatisfiable", searchStats: { checked, total: candidates.length, uncertain, nodes: attemptNodes } });
};
