import { isValidAnswerSpelling, type DictionaryEntry } from "./dictionary";
import { answerLetters } from "./layout";

const DANNET_ATTRIBUTION = "DanNet 2026-10-02, Centre for Language Technology, University of Copenhagen and Society for Danish Language and Literature (DSL), CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/; https://github.com/kuhumcst/DanNet/releases/tag/v2026-10-02";

export function exportDictionary(name: string, entries: readonly DictionaryEntry[], attribution?: string) {
  const credit = attribution || (entries.some(entry => entry.source === "dannet") ? DANNET_ATTRIBUTION : undefined);
  const data = JSON.stringify({ format: "krydsvaerk-dictionary", version: 1, name, attribution: credit, entries }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "ordbog"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseDictionaryFile(text: string): { name: string; entries: DictionaryEntry[]; attribution?: string } {
  const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!data || typeof data !== "object") throw new Error("Ugyldigt format");
  const value = data as Record<string, unknown>;
  if (value.format !== "krydsvaerk-dictionary" || value.version !== 1 || typeof value.name !== "string" || !value.name.trim() || !Array.isArray(value.entries) || (value.attribution !== undefined && typeof value.attribution !== "string")) throw new Error("Ugyldigt format");
  const entries = value.entries.map((item: unknown): DictionaryEntry => {
    if (!item || typeof item !== "object") throw new Error("Ugyldig post");
    const entry = item as Record<string, unknown>;
    if (typeof entry.word !== "string" || !isValidAnswerSpelling(entry.word) || typeof entry.clue !== "string" || !entry.clue.trim() || (entry.clueGroupId !== undefined && typeof entry.clueGroupId !== "string") || (entry.partOfSpeech !== undefined && typeof entry.partOfSpeech !== "string")) throw new Error("Ugyldig post");
    return { word: entry.word, clue: entry.clue, length: answerLetters(entry.word).length, source: "custom", clueGroupId: entry.clueGroupId as string | undefined, partOfSpeech: entry.partOfSpeech as string | undefined };
  });
  return { name: value.name.trim(), entries, attribution: value.attribution as string | undefined };
}
