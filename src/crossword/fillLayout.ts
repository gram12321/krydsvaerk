import { indexWordScores, isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";
import { answerLetters, fitsBreaks, solverLayout, validateLayout, validateSolverLayout, wordCells, type GridLayout } from "./layout";

export type FillResult =
  | { status: "solved"; answers: Record<string, DictionaryEntry> }
  | { status: "invalid"; errors: string[] }
  | { status: "unsatisfiable" }
  | { status: "limit"; answers?: Record<string, DictionaryEntry> };

export interface FillProgress { nodes: number; solutions: number; bestScore: number | null }

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ";
interface LengthIndex { entries: DictionaryEntry[]; masks: Uint32Array[][]; full: Uint32Array }
interface Crossing { other: number; position: number; otherPosition: number }

/** Reuse only with the same, unchanged dictionary. Search domains are always copied. */
export function createFillCache(dictionary: readonly DictionaryEntry[], lengths: Set<number>) {
  return { dictionary, index: makeIndex(dictionary, lengths), scores: indexWordScores(dictionary), patterns: new Map<string, Uint32Array>() };
}
export type FillCache = ReturnType<typeof createFillCache>;

function countBits(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function makeIndex(entries: readonly DictionaryEntry[], lengths: Set<number>): Map<number, LengthIndex> {
  const groups = new Map<number, DictionaryEntry[]>();
  const seen = new Set<string>();
  // Custom clues override built-in entries; an emoji entry must remain
  // available to the solver even when the same spelling exists elsewhere.
  const ordered = [...entries.filter(e => e.source === "custom"), ...entries.filter(e => e.source === "emoji"), ...entries.filter(e => e.source !== "custom" && e.source !== "emoji")];
  for (const entry of ordered) {
    if (!lengths.has(answerLetters(entry.word).length) || !isValidAnswerSpelling(entry.word) || seen.has(entry.word)) continue;
    seen.add(entry.word);
    const length = answerLetters(entry.word).length;
    const bucket = groups.get(length) ?? [];
    bucket.push(entry); groups.set(length, bucket);
  }
  const result = new Map<number, LengthIndex>();
  for (const [length, words] of groups) {
    const blocks = Math.ceil(words.length / 32);
    const masks = Array.from({ length }, () => Array.from({ length: ALPHABET.length }, () => new Uint32Array(blocks)));
    const full = new Uint32Array(blocks);
    words.forEach((entry, id) => {
      full[id >>> 5] |= 1 << (id & 31);
      const letters = answerLetters(entry.word);
      for (let p = 0; p < length; p++) masks[p][ALPHABET.indexOf(letters[p])][id >>> 5] |= 1 << (id & 31);
    });
    result.set(length, { entries: words, masks, full });
  }
  return result;
}

/** Fill a complete layout, propagating crossing constraints before each search step. */
export function fillLayout(layout: GridLayout, dictionary: readonly DictionaryEntry[], maxNodes = 10000, fixedLetters: Readonly<Record<string, string>> = {}, optimize = false, onProgress?: (progress: FillProgress) => void, cache?: FillCache, requiredWords: readonly string[] = []): FillResult {
  const errors = validateSolverLayout(layout);
  if (errors.length) return { status: "invalid", errors };
  const partial = validateLayout(layout).length > 0;
  layout = solverLayout(layout);
  const usableCache = cache?.dictionary === dictionary ? cache : undefined;
  const index = usableCache?.index ?? makeIndex(dictionary, new Set(layout.words.map(word => word.length)));
  const indexes = layout.words.map(word => index.get(word.length));
  if (indexes.some(item => !item)) return { status: "unsatisfiable" };
  const requiredIds = requiredWords.map(required => indexes.map(index => index!.entries.findIndex(entry => entry.word === required)));
  if (requiredIds.some(ids => ids.every(id => id < 0))) return { status: "unsatisfiable" };
  const slots = layout.words.map(word => wordCells(word).map(p => `${p.row},${p.col}`));
  // Adjacent occupied cells in an unfinished crossing must be able to form
  // part of a dictionary answer, with room to extend on either side.
  const provisional: { cells: string[]; before: number; after: number }[] = [];
  if (partial) {
    const occupied = new Set([...slots.flat(), ...Object.keys(fixedLetters).filter(key => fixedLetters[key])]);
    const blocked = (row: number, col: number) => row < 0 || col < 0 || row >= layout.height || col >= layout.width
      || [...layout.clues, ...layout.images].some(a => row >= a.row && row < a.row + a.height && col >= a.col && col < a.col + a.width)
      || (layout.blocks ?? []).some(p => p.row === row && p.col === col)
      || (layout.arrows ?? []).some(p => p.row === row && p.col === col);
    for (const direction of ["across", "down"] as const) {
      const dr = direction === "down" ? 1 : 0, dc = direction === "across" ? 1 : 0;
      for (let row = 0; row < layout.height; row++) for (let col = 0; col < layout.width; col++) {
        const cellKey = `${row},${col}`;
        if (!occupied.has(cellKey) || occupied.has(`${row - dr},${col - dc}`)) continue;
        const cells: string[] = [];
        let r = row, c = col;
        while (!blocked(r, c) && occupied.has(`${r},${c}`)) { cells.push(`${r},${c}`); r += dr; c += dc; }
        if (cells.length < 2 || layout.words.some(word => word.direction === direction && cells.every(cell => slots[layout.words.indexOf(word)].includes(cell)))) continue;
        let before = 0, after = 0;
        while (!blocked(row - dr * (before + 1), col - dc * (before + 1))) before++;
        while (!blocked(r + dr * after, c + dc * after)) after++;
        provisional.push({ cells, before, after });
      }
    }
  }
  const provisionalWords = provisional.length ? [...new Set(dictionary.filter(entry => isValidAnswerSpelling(entry.word) && !/-/.test(entry.word)).map(entry => entry.word))] : [];
  const provisionalCache = new Map<string, boolean>();
  function possiblePartialWords(domains: Uint32Array[]): boolean {
    if (!provisional.length) return true;
    const letters = { ...fixedLetters };
    domains.forEach((domain, i) => {
      let count = 0, id = -1;
      domain.forEach((value, block) => { count += countBits(value); if (value) id = (block << 5) + (31 - Math.clz32(value & -value)); });
      if (count === 1) answerLetters(indexes[i]!.entries[id].word).split("").forEach((letter, p) => { letters[slots[i][p]] = letter; });
    });
    return provisional.every(({ cells, before, after }) => {
      const pattern = cells.map(cell => letters[cell] ?? "").join("");
      if (pattern.length !== cells.length) return true;
      const key = `${before},${after}:${pattern}`;
      let possible = provisionalCache.get(key);
      if (possible === undefined) {
        possible = provisionalWords.some(word => {
          if (word.length < pattern.length || word.length > before + pattern.length + after) return false;
          for (let offset = Math.max(0, word.length - pattern.length - after); offset <= Math.min(before, word.length - pattern.length); offset++) {
            if (word.startsWith(pattern, offset)) return true;
          }
          return false;
        });
        provisionalCache.set(key, possible);
      }
      return possible;
    });
  }
  const crossings: Crossing[][] = slots.map(() => []);
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    slots[i].forEach((cell, position) => {
      const otherPosition = slots[j].indexOf(cell);
      if (otherPosition >= 0) {
        crossings[i].push({ other: j, position, otherPosition });
        crossings[j].push({ other: i, position: otherPosition, otherPosition: position });
      }
    });
  }
  const scores = usableCache?.scores ?? indexWordScores(dictionary);
  let best: Uint32Array[] | null = null;
  let bestScore = -1;
  let bestKey = "";
  let nodes = 0;
  let solutions = 0;
  let limited = false;
  const report = () => onProgress?.({ nodes, solutions, bestScore: bestScore < 0 ? null : bestScore });
  function propagate(domains: Uint32Array[], queue: number[]): boolean {
    const queued = new Set(queue);
    const enqueue = (i: number) => { if (!queued.has(i)) { queue.push(i); queued.add(i); } };
    while (queue.length) {
      const i = queue.pop()!; queued.delete(i);
      const source = indexes[i]!;
      const domain = domains[i];
      let count = 0, only = -1;
      for (let block = 0; block < domain.length; block++) {
        const value = domain[block]; count += countBits(value);
        if (value) only = (block << 5) + (31 - Math.clz32(value & -value));
      }
      if (!count) return false;
      if (count === 1) {
        // Indexes are shared by length, so the same bit is the same spelling.
        for (let j = 0; j < domains.length; j++) if (j !== i && indexes[j] === source) {
          const block = only >>> 5, bit = 1 << (only & 31);
          if (domains[j][block] & bit) { domains[j][block] = (domains[j][block] & ~bit) >>> 0; enqueue(j); }
        }
      }
      for (const { other, position, otherPosition } of crossings[i]) {
        const target = indexes[other]!;
        const allowed = new Uint32Array(target.full.length);
        for (let letter = 0; letter < ALPHABET.length; letter++) {
          const mask = source.masks[position][letter];
          let exists = false;
          for (let k = 0; k < domain.length; k++) if (domain[k] & mask[k]) { exists = true; break; }
          if (exists) for (let k = 0; k < allowed.length; k++) allowed[k] |= target.masks[otherPosition][letter][k];
        }
        let changed = false, nonempty = false;
        for (let k = 0; k < allowed.length; k++) {
          const value = (domains[other][k] & allowed[k]) >>> 0;
          if (value !== domains[other][k]) { domains[other][k] = value; changed = true; }
          if (value) nonempty = true;
        }
        if (!nonempty) return false;
        if (changed) enqueue(other);
      }
    }
    return true;
  }
  function search(domains: Uint32Array[], queue: number[]): Uint32Array[] | null {
    if (nodes >= maxNodes) { limited = true; return null; }
    nodes++;
    if (nodes % 100 === 0) report();
    if (!propagate(domains, queue)) return null;
    if (!possiblePartialWords(domains)) return null;
    for (const ids of requiredIds) {
      const possible = domains.some((domain, i) => ids[i] >= 0 && (domain[ids[i] >>> 5] & (1 << (ids[i] & 31))));
      if (!possible) return null;
    }
    if (optimize) {
      let upper = 0;
      for (let i = 0; i < domains.length; i++) {
        let max = 0;
        domains[i].forEach((value, block) => {
          while (value) { const bit = 31 - Math.clz32(value & -value); max = Math.max(max, scores.get(indexes[i]!.entries[(block << 5) + bit].word) ?? 0); value = (value & (value - 1)) >>> 0; }
        });
        upper += max;
      }
      if (upper <= bestScore) return null;
    }
    let target = -1, smallest = Infinity;
    for (let i = 0; i < domains.length; i++) {
      let count = 0;
      for (const value of domains[i]) count += countBits(value);
      if (count > 1 && count < smallest) { target = i; smallest = count; }
    }
    if (target < 0) {
      solutions++;
      if (!optimize) return domains;
      const words = domains.map((domain, i) => { const block = domain.findIndex(value => value !== 0); const id = (block << 5) + (31 - Math.clz32(domain[block] & -domain[block])); return indexes[i]!.entries[id].word; });
      const score = words.reduce((sum, word) => sum + (scores.get(word) ?? 0), 0);
      const key = words.join("\0");
      if (score > bestScore || (score === bestScore && key.localeCompare(bestKey, "da") < 0)) { best = domains; bestScore = score; bestKey = key; }
      report();
      return null;
    }
    const ids: number[] = [];
    domains[target].forEach((value, block) => {
      while (value) { const bit = 31 - Math.clz32(value & -value); ids.push((block << 5) + bit); value = (value & (value - 1)) >>> 0; }
    });
    if (optimize) ids.sort((a, b) => (scores.get(indexes[target]!.entries[b].word) ?? 0) - (scores.get(indexes[target]!.entries[a].word) ?? 0) || indexes[target]!.entries[a].word.localeCompare(indexes[target]!.entries[b].word, "da"));
    else {
      // Prefer answers that leave the most choices in intersecting slots.
      // Random ordering can spend the entire budget on a promising-looking
      // answer that leaves one of its neighbours almost impossible to fill.
      const support = crossings[target].map(crossing => {
        const counts = new Map<string, number>();
        const other = indexes[crossing.other]!;
        for (let letter = 0; letter < ALPHABET.length; letter++) {
          let count = 0;
          const mask = other.masks[crossing.otherPosition][letter];
          for (let block = 0; block < mask.length; block++) count += countBits(mask[block] & domains[crossing.other][block]);
          counts.set(ALPHABET[letter], count);
        }
        return { position: crossing.position, counts };
      });
      const ranked = ids.map(id => {
        const letters = answerLetters(indexes[target]!.entries[id].word);
        return { id, score: support.reduce((sum, crossing) => sum + Math.log1p(crossing.counts.get(letters[crossing.position]) ?? 0), 0), tie: Math.random() };
      });
      ranked.sort((a, b) => b.score - a.score || a.tie - b.tie);
      for (let i = 0; i < ranked.length; i++) ids[i] = ranked[i].id;
    }
    for (const id of ids) {
      const next = domains.map(domain => domain.slice());
      next[target].fill(0); next[target][id >>> 5] = 1 << (id & 31);
      const result = search(next, [target]);
      if (result) return result;
      if (limited) break;
    }
    return null;
  }
  const domains: Uint32Array[] = [];
  for (let i = 0; i < slots.length; i++) {
    const letters = slots[i].map(cell => fixedLetters[cell] || "");
    if (letters.some(letter => letter && ALPHABET.indexOf(letter) < 0)) return { status: "unsatisfiable" };
    const cue = layout.clues.find(item => item.id === layout.words[i].clueId);
    const appliesEmoji = Boolean(cue?.emojiAny && (!cue.emojiDirection || cue.emojiDirection === layout.words[i].direction)
      || cue?.emoji && (!cue.emojiDirection || cue.emojiDirection === layout.words[i].direction));
    const emojiWords = appliesEmoji ? new Set(dictionary.filter(entry => entry.source === "emoji" && (cue!.emojiAny || entry.clue === cue!.emoji)).map(entry => entry.word)) : undefined;
    const key = JSON.stringify([layout.words[i].length, layout.words[i].breaks ?? [], appliesEmoji ? cue?.emojiAny ? true : cue?.emoji : null, letters]);
    let domain = usableCache?.patterns.get(key);
    if (!domain) {
      domain = indexes[i]!.full.slice();
      indexes[i]!.entries.forEach((entry, id) => {
        if (!fitsBreaks(layout.words[i], entry.word) || (emojiWords && !emojiWords.has(entry.word))) domain![id >>> 5] &= ~(1 << (id & 31));
      });
      for (let position = 0; position < letters.length; position++) {
        if (!letters[position]) continue;
        const mask = indexes[i]!.masks[position][ALPHABET.indexOf(letters[position])];
        for (let block = 0; block < domain.length; block++) domain[block] &= mask[block];
      }
      if (usableCache) {
        if (usableCache.patterns.size >= 512) usableCache.patterns.delete(usableCache.patterns.keys().next().value!);
        usableCache.patterns.set(key, domain);
      }
    }
    domains.push(domain.slice());
  }
  const found = search(domains, domains.map((_, i) => i));
  report();
  const solution = optimize ? best : found;
  if (!solution) return { status: limited ? "limit" : "unsatisfiable" };
  const answers = Object.fromEntries(layout.words.map((word, i) => {
    const domain = solution[i];
    const block = domain.findIndex(value => value !== 0);
    const id = (block << 5) + (31 - Math.clz32(domain[block] & -domain[block]));
    const answer = indexes[i]!.entries[id];
    const cue = layout.clues.find(item => item.id === word.clueId);
    const appliesEmoji = Boolean((cue?.emojiAny || cue?.emoji) && (!cue.emojiDirection || cue.emojiDirection === word.direction));
    const cueEntry = appliesEmoji ? dictionary.find(entry => entry.word === answer.word && entry.source === "emoji" && (cue!.emojiAny || entry.clue === cue!.emoji)) : undefined;
    return [word.id, cueEntry ?? answer];
  }));
  return limited ? { status: "limit", answers } : { status: "solved", answers };
}
