import { createFillCache, fillLayout } from "./fillLayout";
import type { DictionaryEntry } from "./dictionary";
import { createDesignerTemplateLayout } from "./templateLayouts";
import type { GridLayout } from "./layout";

type Request = {
  size: number;
  entries: DictionaryEntry[];
  includeHyphenatedWords: boolean;
  includeEmojiCues?: boolean;
  forcedHyphenatedWordCount?: number;
  image?: { width: number; height: number; illustration?: string };
  previousLayout?: GridLayout;
};

self.onmessage = async (event: MessageEvent<Request>) => {
  const { size, entries, includeHyphenatedWords, includeEmojiCues = false, forcedHyphenatedWordCount = 0, image, previousLayout } = event.data;
  // Try more different geometries before spending a large budget on any one.
  // Some valid grids are much easier to fill than others of the same size.
  const attempts = 28;
  const cache = createFillCache(entries, new Set(Array.from({ length: size }, (_, i) => i + 1)));
  let limited = 0;
  let confirmed: GridLayout | undefined;
  let confirmedAnswers: Record<string, DictionaryEntry> | undefined;
  let confirmedAt = 0;
  let completed = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    completed = attempt;
    const candidate = createDesignerTemplateLayout(size, {
      dictionary: entries,
      includeHyphenatedWords: (Boolean(confirmed) || forcedHyphenatedWordCount > 0) && includeHyphenatedWords,
      includeEmojiCues,
      forcedHyphenatedWordCount,
      maxAnswerLength: forcedHyphenatedWordCount > 0 ? (attempt % 3 === 0 ? 8 : 6) : confirmed ? (attempt === confirmedAt + 1 ? 8 : undefined) : 6,
      image,
      previousLayout: attempt === 1 ? previousLayout : undefined,
    });
    if (!candidate) {
      if (confirmed && attempt - confirmedAt >= 3) break;
      continue;
    }

    let nodes = 0;
    const result = fillLayout(candidate, entries, attempt <= 24 ? 2000 : 12000, {}, false, progress => {
      nodes = progress.nodes;
      if (progress.nodes % 1000 === 0) self.postMessage({ type: "progress", attempt, attempts, nodes, limited: false });
    }, cache);
    self.postMessage({ type: "progress", attempt, attempts, nodes, limited: result.status === "limit" });
    if (result.status === "solved") {
      if (confirmed) {
        self.postMessage({ type: "done", layout: candidate, answers: result.answers, attempts: attempt, limited });
        return;
      }
      confirmed = candidate;
      confirmedAnswers = result.answers;
      confirmedAt = attempt;
    }
    if (result.status === "limit") limited++;
    if (confirmed && attempt - confirmedAt >= 3) break;
    // Let the UI process progress and cancellation before beginning another search.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  if (confirmed) self.postMessage({ type: "done", layout: confirmed, answers: confirmedAnswers, attempts: completed, limited });
  else self.postMessage({ type: "failed", attempts, limited });
};
