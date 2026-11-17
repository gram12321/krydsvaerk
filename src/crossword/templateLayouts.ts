import { answerBreaks, answerLetters, validateLayout, wordCells, type GridLayout, type GridWord, type Point } from "./layout";
import { isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";

const SEEDS: Record<number, string[]> = {
  9: ["#########", "#....#...", "#....#...", "#..####..", "#....#...", "###....##", "#...#....", "#..#..#..", "#..#..#.."],
  11: ["###########", "#..#....#..", "#..#....#..", "#....##....", "###...#..##", "#...#..#...", "#....#..#..", "#..#..#....", "###...#..##", "#...#..#...", "#...#..#..."],
  13: ["#############", "#...#....#...", "#...#....#...", "#....##...#..", "#..#....#....", "###....#...##", "#....#...#...", "#..##....##..", "#..#..##..#..", "###....##..##", "#...##..##...", "#....#..#....", "#....#..#...."],
};

/** Randomly varies a connected clues-in-squares pattern, then derives every clue from its answer start. */
export function createTemplateLayout(size: number): GridLayout | null {
  const seed = SEEDS[size];
  if (!seed) return null;
  for (let attempt = 0; attempt < 500; attempt++) {
    const mask = seed.map(row => [...row]);
    const flips = attempt === 0 ? 0 : 1 + Math.floor(Math.random() * Math.max(1, Math.floor(size * size * 0.035)));
    for (let n = 0; n < flips; n++) {
      const row = 1 + Math.floor(Math.random() * (size - 1));
      const col = 1 + Math.floor(Math.random() * (size - 1));
      mask[row][col] = mask[row][col] === "." ? "#" : ".";
    }
    const layout = layoutFromMask(mask);
    if (layout && validateLayout(layout).length === 0) return layout;
  }
  return null;
}

export interface DesignerTemplateOptions {
  dictionary?: readonly DictionaryEntry[];
  includeHyphenatedWords?: boolean;
  image?: { width: number; height: number; illustration?: string };
  previousLayout?: GridLayout;
  maxAnswerLength?: number;
}

type SeedFamily = "balanced" | "long-runs" | "staggered";
interface SeparatorRun { direction: "across" | "down"; start: Point; physicalLength: number; breaks: number[] }
interface TemplateCandidate { layout: GridLayout; score: number }

/**
 * Build a varied, editable designer layout from one of several deliberate
 * families. Player puzzle generation continues to use createTemplateLayout.
 */
export function createDesignerTemplateLayout(size: number, options: DesignerTemplateOptions = {}): GridLayout | null {
  const seed = SEEDS[size];
  if (!seed) return null;
  const image = options.image;
  if (image && (!Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > size - 3 || image.height > size - 3)) return null;

  const hyphenWords = options.includeHyphenatedWords === false ? [] : eligibleHyphenWords(options.dictionary ?? [], size);
  const candidates: TemplateCandidate[] = [];
  const slotCounts = new Map<string, Set<string>>();
  for (const entry of options.dictionary ?? []) {
    if (!isValidAnswerSpelling(entry.word)) continue;
    const key = `${answerLetters(entry.word).length}:${answerBreaks(entry.word).join(",")}`;
    const words = slotCounts.get(key) ?? new Set<string>();
    words.add(entry.word);
    slotCounts.set(key, words);
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    const family = options.maxAnswerLength ? chooseRandom(["balanced", "staggered"] as const) : chooseRandom(["balanced", "long-runs", "staggered"] as const);
    const mask = makeFamilyMask(seed, size, family);
    mutateMask(mask, size, Math.max(5, Math.floor(size * 0.8)));

    const imageArea = image ? reserveImagePocket(mask, size, image.width, image.height) : undefined;
    if (image && !imageArea) continue;

    const separator = hyphenWords.length && Math.random() < 0.3 ? chooseSeparatorRun(size, hyphenWords) : undefined;
    const arrows = new Map<string, "across" | "down">();
    if (separator) {
      reserveSeparatorRun(mask, separator);
      for (let index = 0; index < separator.breaks.length; index++) {
        const letterOffset = separator.breaks[index] + index;
        const point = separator.direction === "across"
          ? { row: separator.start.row, col: separator.start.col + letterOffset }
          : { row: separator.start.row + letterOffset, col: separator.start.col };
        arrows.set(pointKey(point), separator.direction);
      }
    }

    if (options.maxAnswerLength) shortenRuns(mask, size, options.maxAnswerLength);

    const layout = layoutFromDesignerMask(mask, size, arrows, imageArea, image?.illustration);
    if (!layout || validateLayout(layout).length || !hasConnectedWords(layout)) continue;
    if (options.maxAnswerLength && layout.words.some(word => word.length > options.maxAnswerLength!)) continue;
    // Do not let random masks regress to the old short-slot pattern.
    if (layout.words.filter(word => word.length > 4).length < 2) continue;
    if (slotCounts.size && layout.words.some(word => !slotCounts.get(`${word.length}:${(word.breaks ?? []).join(",")}`)?.size)) continue;
    const dictionaryScore = slotCounts.size ? layout.words.reduce((score, word) => {
      const count = slotCounts.get(`${word.length}:${(word.breaks ?? []).join(",")}`)?.size ?? 0;
      return score + Math.log1p(count);
    }, 0) / layout.words.length : 0;
    candidates.push({ layout, score: scoreLayout(layout) + dictionaryScore * 12 + Math.random() * 5 });
  }
  if (!candidates.length) {
    if (image) return null;
    if (options.maxAnswerLength) return null;
    const fallbackMask = makeFamilyMask(seed, size, "long-runs");
    for (let index = 1; index < size; index++) { fallbackMask[size - 1][index] = "."; fallbackMask[index][size - 1] = "."; }
    const fallback = layoutFromDesignerMask(fallbackMask, size, new Map());
    if (fallback && !validateLayout(fallback).length && hasConnectedWords(fallback)) return fallback;
    return null;
  }

  const previous = options.previousLayout;
  candidates.sort((a, b) => {
    const diversityA = previous && previous.width === size && previous.height === size ? layoutDifference(a.layout, previous) * 1.5 : 0;
    const diversityB = previous && previous.width === size && previous.height === size ? layoutDifference(b.layout, previous) * 1.5 : 0;
    return b.score + diversityB - a.score - diversityA;
  });
  const finalistCount = Math.min(8, candidates.length);
  return candidates[Math.floor(Math.random() * finalistCount)].layout;
}

/** Split long runs using interior clue cells, without changing the outer edges. */
function shortenRuns(mask: string[][], size: number, maximum: number): void {
  for (const direction of ["across", "down"] as const) {
    for (let line = 1; line < size; line++) {
      let run = 0;
      for (let position = 1; position < size; position++) {
        const row = direction === "across" ? line : position;
        const col = direction === "across" ? position : line;
        if (mask[row][col] === "#") { run = 0; continue; }
        if (++run > maximum && row < size - 1 && col < size - 1) {
          mask[row][col] = "#";
          run = 0;
        }
      }
    }
  }
}

function eligibleHyphenWords(dictionary: readonly DictionaryEntry[], size: number): DictionaryEntry[] {
  const seen = new Set<string>();
  return dictionary.filter(entry => {
    const breaks = answerBreaks(entry.word);
    const letters = answerLetters(entry.word).length;
    const physicalLength = letters + breaks.length;
    if (!breaks.length || letters < 5 || physicalLength > size - 1 || seen.has(entry.word)) return false;
    seen.add(entry.word);
    return true;
  });
}

function makeFamilyMask(seed: string[], size: number, family: SeedFamily): string[][] {
  // Rearrange the seed's interior without moving the clue edges. Transposing,
  // shifting, and reflecting create genuinely different structural families.
  const transpose = Math.random() < 0.5;
  const reflectRows = Math.random() < 0.5;
  const reflectCols = Math.random() < 0.5;
  const rowShift = Math.floor(Math.random() * (size - 1));
  const colShift = Math.floor(Math.random() * (size - 1));
  const source = seed.map(row => [...row]);
  const mask = seed.map(row => [...row]);
  for (let row = 1; row < size; row++) for (let col = 1; col < size; col++) {
    const r = (reflectRows ? size - 1 - row : row - 1) + rowShift;
    const c = (reflectCols ? size - 1 - col : col - 1) + colShift;
    const sourceRow = 1 + (transpose ? c : r) % (size - 1);
    const sourceCol = 1 + (transpose ? r : c) % (size - 1);
    mask[row][col] = source[sourceRow][sourceCol];
  }
  if (family === "long-runs") {
    const row = 1 + Math.floor(Math.random() * (size - 1));
    const col = 1 + Math.floor(Math.random() * (size - 1));
    for (let index = 1; index < size; index++) { mask[row][index] = "."; mask[index][col] = "."; }
  } else if (family === "staggered") {
    const offset = Math.floor(Math.random() * (size - 1));
    const rows = [0, Math.floor(size / 3), Math.floor(size * 2 / 3)].map(row => 1 + (row + offset) % (size - 1));
    for (const [index, row] of rows.entries()) {
      const start = 1 + ((index * 2 + row) % Math.max(1, size - 5));
      for (let col = start; col < Math.min(size, start + 5); col++) mask[row][col] = ".";
    }
    for (let col = 2; col < size - 1; col += 3) {
      const start = 1 + (col % Math.max(1, size - 5));
      for (let row = start; row < Math.min(size, start + 4); row++) mask[row][col] = ".";
    }
  }
  return mask;
}

function layoutDifference(a: GridLayout, b: GridLayout): number {
  const kinds = (layout: GridLayout) => {
    const cells = Array(layout.width * layout.height).fill("letter") as string[];
    for (const clue of layout.clues) for (let r = clue.row; r < clue.row + clue.height; r++) for (let c = clue.col; c < clue.col + clue.width; c++) cells[r * layout.width + c] = "clue";
    for (const block of layout.blocks ?? []) cells[block.row * layout.width + block.col] = "block";
    for (const arrow of layout.arrows ?? []) cells[arrow.row * layout.width + arrow.col] = `arrow-${arrow.direction}`;
    for (const image of layout.images) for (let r = image.row; r < image.row + image.height; r++) for (let c = image.col; c < image.col + image.width; c++) cells[r * layout.width + c] = "image";
    return cells;
  };
  const first = kinds(a), second = kinds(b);
  return first.reduce((count, kind, index) => count + Number(kind !== second[index]), 0);
}

function mutateMask(mask: string[][], size: number, maximumFlips: number): void {
  const flips = 1 + Math.floor(Math.random() * maximumFlips);
  for (let count = 0; count < flips; count++) {
    const row = 1 + Math.floor(Math.random() * Math.max(1, size - 2));
    const col = 1 + Math.floor(Math.random() * Math.max(1, size - 2));
    // Opening a wall is more common than closing a lane, which adds longer
    // answers while still allowing occasional denser patterns.
    if (mask[row][col] === "#") mask[row][col] = Math.random() < 0.78 ? "." : "#";
    else mask[row][col] = Math.random() < 0.3 ? "#" : ".";
  }
}

function reserveImagePocket(mask: string[][], size: number, width: number, height: number): { row: number; col: number; width: number; height: number } | undefined {
  const positions: Point[] = [];
  for (let row = 1; row + height < size - 1; row++) {
    for (let col = 1; col + width < size - 1; col++) positions.push({ row, col });
  }
  for (const { row, col } of shuffle(positions)) {
    // The extra row below and column to the right become ordinary clue cells
    // for any runs that resume after the picture; the picture itself is visual.
    for (let r = row; r <= row + height; r++) for (let c = col; c <= col + width; c++) mask[r][c] = "#";
    return { row, col, width, height };
  }
  return undefined;
}

function chooseSeparatorRun(size: number, entries: DictionaryEntry[]): SeparatorRun | undefined {
  const entry = chooseRandom(entries);
  const breaks = answerBreaks(entry.word);
  const physicalLength = answerLetters(entry.word).length + breaks.length;
  const direction = Math.random() < 0.5 ? "across" : "down";
  return {
    direction,
    start: direction === "across"
      ? { row: size - 1, col: size - physicalLength }
      : { row: size - physicalLength, col: size - 1 },
    physicalLength,
    breaks,
  };
}

function reserveSeparatorRun(mask: string[][], run: SeparatorRun): void {
  for (let offset = 0; offset < run.physicalLength; offset++) {
    const row = run.start.row + (run.direction === "down" ? offset : 0);
    const col = run.start.col + (run.direction === "across" ? offset : 0);
    mask[row][col] = ".";
  }
  const before = run.direction === "across"
    ? { row: run.start.row, col: run.start.col - 1 }
    : { row: run.start.row - 1, col: run.start.col };
  if (before.row > 0 && before.col > 0) mask[before.row][before.col] = "#";
}

function layoutFromDesignerMask(
  mask: string[][],
  size: number,
  arrows: Map<string, "across" | "down">,
  imageArea?: { row: number; col: number; width: number; height: number },
  illustration?: string,
): GridLayout | null {
  const words: GridWord[] = [];
  for (const direction of ["across", "down"] as const) {
    for (let line = 1; line < size; line++) {
      let position = 1;
      while (position < size) {
        const pointAt = (offset: number): Point => direction === "across" ? { row: line, col: offset } : { row: offset, col: line };
        const point = pointAt(position);
        const symbol = mask[point.row][point.col];
        const arrowDirection = arrows.get(pointKey(point));
        if ((arrowDirection && arrowDirection !== direction) || (symbol !== "." && arrowDirection !== direction)) { position++; continue; }
        const first = position;
        let letters = 0;
        const breaks: number[] = [];
        while (position < size) {
          const current = pointAt(position);
          const currentArrow = arrows.get(pointKey(current));
          if ((currentArrow && currentArrow !== direction) || (mask[current.row][current.col] !== "." && currentArrow !== direction)) break;
          if (currentArrow === direction) breaks.push(letters);
          else letters++;
          position++;
        }
        if (!letters) continue;
        const start = pointAt(first);
        const clue = direction === "across" ? { row: start.row, col: start.col - 1 } : { row: start.row - 1, col: start.col };
        words.push({
          id: `${direction}-${start.row}-${start.col}`,
          clueId: String(clue.row * size + clue.col),
          start,
          direction,
          length: letters,
          ...(breaks.length ? { breaks } : {}),
        });
      }
    }
  }
  if (!words.length) return null;

  const imageId = imageArea ? `image-${imageArea.row}-${imageArea.col}` : undefined;
  const image: GridLayout["images"] = imageArea ? [{ ...imageArea, id: imageId!, illustration }] : [];
  const active = new Set(words.map(word => word.clueId));
  const activePoints = new Set([...active].map(id => {
    const value = Number(id);
    return pointKey({ row: Math.floor(value / size), col: value % size });
  }));
  if (imageArea) {
    for (let row = imageArea.row; row < imageArea.row + imageArea.height; row++) {
      for (let col = imageArea.col; col < imageArea.col + imageArea.width; col++) if (activePoints.has(pointKey({ row, col }))) return null;
    }
  }

  const clues: GridLayout["clues"] = [...active].map(id => {
    const index = Number(id);
    return { id, row: Math.floor(index / size), col: index % size, width: 1, height: 1 };
  });
  const occupied = new Set<string>([...activePoints]);
  if (imageArea) for (let row = imageArea.row; row < imageArea.row + imageArea.height; row++) {
    for (let col = imageArea.col; col < imageArea.col + imageArea.width; col++) occupied.add(pointKey({ row, col }));
  }
  for (const point of arrows.keys()) occupied.add(point);

  const singleWordCues = [...active].filter(id => words.filter(word => word.clueId === id).length === 1);
  const clueWords = new Map(singleWordCues.map(id => [id, words.find(word => word.clueId === id)!]));
  const rectangularTargets = { across: Math.max(1, Math.floor(size / 5)), down: Math.max(1, Math.floor(size / 5)) };
  for (const direction of shuffle(["across", "down"] as const)) {
    const choices = shuffle(singleWordCues.filter(id => clueWords.get(id)?.direction === direction));
    let created = 0;
    for (const id of choices) {
      if (created >= rectangularTargets[direction]) break;
      const index = Number(id);
      const row = Math.floor(index / size), col = index % size;
      const extension = direction === "across" ? { row, col: col - 1 } : { row: row - 1, col };
      const extensionKey = pointKey(extension);
      if (extension.row < 0 || extension.col < 0 || mask[extension.row][extension.col] !== "#" || occupied.has(extensionKey)) continue;
      const clue = clues.find(item => item.id === id)!;
      const expandedId = String(extension.row * size + extension.col);
      if (direction === "across") { clue.col--; clue.width = 2; }
      else { clue.row--; clue.height = 2; }
      clue.id = expandedId;
      for (const word of words) if (word.clueId === id) word.clueId = expandedId;
      occupied.add(extensionKey);
      created++;
    }
  }

  const blocks: Point[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (mask[row][col] !== "#") continue;
    const point = { row, col };
    if (!occupied.has(pointKey(point))) blocks.push(point);
  }
  return {
    width: size,
    height: size,
    clues,
    images: image,
    words,
    blocks,
    arrows: [...arrows].map(([key, direction]) => {
      const [row, col] = key.split(",").map(Number);
      return { row, col, direction };
    }),
  };
}

function hasConnectedWords(layout: GridLayout): boolean {
  if (!layout.words.length) return false;
  const cells = new Map<string, number[]>();
  layout.words.forEach((word, index) => wordCells(word).forEach(point => {
    const key = pointKey(point);
    const list = cells.get(key) ?? [];
    list.push(index);
    cells.set(key, list);
  }));
  const connected = new Set<number>([0]);
  const pending = [0];
  while (pending.length) {
    const word = pending.pop()!;
    for (const point of wordCells(layout.words[word])) {
      for (const other of cells.get(pointKey(point)) ?? []) if (!connected.has(other)) { connected.add(other); pending.push(other); }
    }
  }
  return connected.size === layout.words.length;
}

function scoreLayout(layout: GridLayout): number {
  const longWords = layout.words.filter(word => word.length > 4).length;
  const shortPenalty = layout.words.filter(word => word.length < 3).length;
  const wide = layout.clues.filter(clue => clue.width === 2).length;
  const tall = layout.clues.filter(clue => clue.height === 2).length;
  const lengthVariety = new Set(layout.words.map(word => word.length)).size;
  const blocks = layout.blocks?.length ?? 0;
  return Math.min(longWords, 8) * 8 + lengthVariety * 3 + Math.min(wide, 3) * 3 + Math.min(tall, 3) * 3
    - shortPenalty * 2 - Math.abs(blocks - 8) * 0.25;
}

function pointKey(point: Point): string { return `${point.row},${point.col}`; }
function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function chooseRandom<T>(values: readonly T[]): T { return values[Math.floor(Math.random() * values.length)]; }

function layoutFromMask(mask: string[][]): GridLayout | null {
  const size = mask.length;
  const words: GridWord[] = [];
  for (const direction of ["across", "down"] as const) for (let line = 1; line < size; line++) {
    let p = 1;
    while (p < size) {
      const at = (i: number) => direction === "across" ? mask[line][i] : mask[i][line];
      if (at(p) === "#") { p++; continue; }
      const first = p;
      while (p < size && at(p) === ".") p++;
      const start = direction === "across" ? { row: line, col: first } : { row: first, col: line };
      const clue = direction === "across" ? { row: start.row, col: start.col - 1 } : { row: start.row - 1, col: start.col };
      words.push({ id: String(words.length), clueId: String(clue.row * size + clue.col), start, direction, length: p - first });
    }
  }

  const active = new Set(words.map(word => word.clueId));
  const clues: GridLayout["clues"] = [];
  const images: GridLayout["images"] = [{ id: "image-0-0", row: 0, col: 0, width: 1, height: 1 }];
  const used = new Set<string>(["0"]);
  const remap = new Map<string, string>();
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const id = String(row * size + col);
    if (mask[row][col] !== "#" || used.has(id)) continue;
    if (active.has(id)) {
      clues.push({ id, row, col, width: 1, height: 1 });
      remap.set(id, id); used.add(id); continue;
    }
    const right = col + 1 < size ? String(row * size + col + 1) : "";
    const below = row + 1 < size ? String((row + 1) * size + col) : "";
    if (active.has(right) && !used.has(right)) {
      clues.push({ id, row, col, width: 2, height: 1 }); remap.set(right, id); used.add(id); used.add(right);
    } else if (active.has(below) && !used.has(below)) {
      clues.push({ id, row, col, width: 1, height: 2 }); remap.set(below, id); used.add(id); used.add(below);
    } else { images.push({ id: `image-${row}-${col}`, row, col, width: 1, height: 1 }); used.add(id); }
  }
  for (const word of words) word.clueId = remap.get(word.clueId) ?? word.clueId;
  return { width: size, height: size, clues, images, words };
}
