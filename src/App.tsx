import { PageIntro, PanelHeading, SiteHeader } from "./Presentation";
import { PanelResizer } from "./PanelResizer";
import { DictionaryBrowser } from "./crossword/DictionaryBrowser";
import { exportDictionary, parseDictionaryFile } from "./crossword/dictionaryFile";
import { BUILTIN_DICTIONARY_COLLECTIONS, countDictionaryWords } from "./crossword/dictionary";
import { customEntryKey, parseCustomEntries, parseCustomDictionaries, type CustomDictionary } from "./crossword/customDictionary";
import { loadPersistedData, publishPublicCrossword, savePersistedValue, setSharedDictionary, STORAGE_KEYS, type PersistedData, type PublicCrossword, type SharedDictionary } from "./lib/persistence";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { dictionary, indexWordScores, parseBuiltinDictionarySettings, type BuiltinDictionarySettings, type DictionaryEntry } from "./crossword/dictionary";
import { BuiltinDictionaryOptions } from "./crossword/BuiltinDictionaryOptions";
import { answerLetters, cluePresentation, fitsBreaks, imageCueTargets, layoutIssues, solverLayout, validateSolverLayout, wordCells, type GridLayout, type GridWord } from "./crossword/layout";
import { editLayout, resizeImageArea, sameSlot, type LayoutTool } from "./crossword/editLayout";
import { puzzleFromLayout, type Puzzle } from "./crossword/generator";
import { Player } from "./Player";
import "./player.css";

const keyOf = (row: number, col: number) => `${row},${col}`;
type SuggestionSolutionBatch = {
  layout: GridLayout;
  dictionary: DictionaryEntry[];
  suggestionDictionary: DictionaryEntry[];
  selected: string;
  baseLetters: Record<string, string>;
  requiredKey: string;
  solutions: { answers: Record<string, DictionaryEntry> }[];
  unsatisfiableCandidates: string[];
  complete: boolean;
};
const tools: { id: "write" | "autofill" | "edit-clue" | LayoutTool; label: string; icon: string; shape?: string }[] = [
  { id: "write", label: "Bogstavfelt / vælg ord", icon: "A" },
  { id: "autofill", label: "Autofyld ord", icon: "?" },
  { id: "edit-clue", label: "Rediger ledetråd", icon: "" },
  { id: "letter", label: "Gør til bogstavfelt", icon: "A", shape: "letter" },
  { id: "clue", label: "Ledetrådsfelt 1 × 1", icon: "↘", shape: "clue" },
  { id: "emoji", label: "Emoji-ledetråd · 1 × 1", icon: "😀", shape: "clue" },
  { id: "wide", label: "Ledetrådsfelt 2 × 1", icon: "↘", shape: "wide" },
  { id: "tall", label: "Ledetrådsfelt 1 × 2", icon: "↘", shape: "tall" },
  { id: "block", label: "Sort felt", icon: "", shape: "dark" },
  { id: "image-area", label: "Billedområde · træk over felter", icon: "▧", shape: "wide" },
  { id: "arrow-across", label: "Bindestreg →", icon: "→", shape: "clue" },
  { id: "arrow-down", label: "Bindestreg ↓", icon: "↓", shape: "clue" },
];
function ToolIcon({ id }: { id: typeof tools[number]["id"] }) {
  return <svg className="board-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {id === "write" && <><path d="M5 19h14M8 16l3.5-9 3.5 9M9.1 13h4.8" /><path d="M17 5v5M14.5 7.5h5" /></>}
    {id === "autofill" && <><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M8 15l7-7M13.5 7l3.5 3.5M7 6v2M6 7h2M17 15v2M16 16h2" /></>}
    {id === "edit-clue" && <><path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4" /><path d="M12 20h8" /></>}
    {id === "letter" && <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 17l4-10 4 10M9.2 14h5.6" /></>}
    {(id === "clue" || id === "wide" || id === "tall") && <><rect x={id === "wide" ? 2 : id === "tall" ? 7 : 4} y={id === "tall" ? 2 : id === "wide" ? 7 : 4} width={id === "wide" ? 20 : id === "tall" ? 10 : 16} height={id === "tall" ? 20 : id === "wide" ? 10 : 16} rx="1" /><path d="M8.5 9h4M8.5 12h3M13 14l3 3m0 0v-3m0 3h-3" /></>}
    {id === "block" && <rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" />}
    {id === "image-area" && <><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="8" cy="9" r="1.4" /><path d="M4 17l5-5 3 3 2.5-2.5L20 18" /></>}
    {id === "arrow-across" && <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M7 12h10m-4-4 4 4-4 4" /></>}
    {id === "arrow-down" && <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 7v10m-4-4 4 4 4-4" /></>}
  </svg>;
}
function describeLayoutError(error: string, layout: GridLayout): string {
  const wordId = /^(?:Missing clue for|Invalid word:|Clue cannot point to|Word outside grid:|Missing arrow in) (.+)$/.exec(error)?.[1];
  if (wordId) {
    const word = layout.words.find(item => item.id === wordId);
    if (word) {
      const location = `Ord fra række ${word.start.row + 1}, kolonne ${word.start.col + 1} (${word.direction === "across" ? "vandret" : "lodret"})`;
      if (error.startsWith("Missing clue")) return `${location} mangler et ledetrådsfelt.`;
      if (error.startsWith("Invalid word")) return `${location} skal have mindst ét bogstav.`;
      if (error.startsWith("Clue cannot")) return `${location} skal have en fri pil fra ledetrådsfeltet.`;
      if (error.startsWith("Missing arrow")) return `${location} mangler en pil ved bindestregen.`;
      return `${location} går uden for feltet.`;
    }
  }
  const location = /(?:at )(\d+),(\d+)/.exec(error);
  if (location) {
    const position = `række ${Number(location[1]) + 1}, kolonne ${Number(location[2]) + 1}`;
    if (error.startsWith("Unused arrow")) return `Pilen i ${position} skal forbinde to dele af et svar.`;
    if (error.startsWith("Empty cell")) return `Bogstavfeltet i ${position} mangler et ord.`;
    return `Kontrollér feltet i ${position}.`;
  }
  const clueId = /^Clue (.+) must/.exec(error)?.[1];
  const clue = layout.clues.find(item => item.id === clueId);
  if (clue) {
    const words = layout.words.filter(word => word.clueId === clue.id);
    const location = `Ledetrådsfeltet i række ${clue.row + 1}, kolonne ${clue.col + 1}`;
    if (words.length > 2) {
      const starts = words.map(word => `${word.direction === "across" ? "vandret" : "lodret"} fra række ${word.start.row + 1}, kolonne ${word.start.col + 1}`).join("; ");
      return `${location} peger automatisk på ${words.length} ord (${starts}). Et ledetrådsfelt kan højst pege på to ord; ændr de tilstødende felter, så højst to ord starter ved feltet.`;
    }
    return `${location} skal pege på mindst ét ord, der starter lige til højre for eller under feltet.`;
  }
  if (error === "No words") return "Feltet skal indeholde mindst ét ord.";
  return "Kontrollér feltets opbygning.";
}
type PublishedItem = { id: string; name: string; puzzle: Puzzle };
type Draft = { id: string; name: string; size: number; layout: GridLayout; letters: Record<string, string>; clues: Record<string, string>; forcedWords?: DictionaryEntry[] };
const LIBRARY_KEY = STORAGE_KEYS.library;
const DRAFTS_KEY = STORAGE_KEYS.drafts;
function validLibrary(value: unknown): PublishedItem[] {
  return Array.isArray(value) ? value.filter((item): item is PublishedItem => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && item.puzzle && Array.isArray(item.puzzle.cells) && Array.isArray(item.puzzle.placements))) : [];
}
function validPublicLibrary(value: unknown): PublishedItem[] {
  return validLibrary(value);
}
export function App() {
  const [page, setPage] = useState<"player" | "designer" | "preview">("player");
  const [justPublished, setJustPublished] = useState(false);
  const [preview, setPreview] = useState<Puzzle | null>(null);
  const [data, setData] = useState<PersistedData | null>(null);
  const [storageError, setStorageError] = useState("");
  const savePlay = useCallback((value: { active: { id: string; puzzle: Puzzle; answers: Record<string, string> }; games: Record<string, { id: string; puzzle: Puzzle; answers: Record<string, string> }> }) => {
    void savePersistedValue(STORAGE_KEYS.play, value).then(() => setData(current => current ? { ...current, [STORAGE_KEYS.play]: value } : current)).catch(() => setStorageError("Din fremgang kunne ikke gemmes i Supabase."));
  }, []);
  useEffect(() => { let active = true; loadPersistedData().then(value => { if (active) setData(value); }).catch(() => { if (active) setStorageError("Forbindelsen til Supabase mislykkedes. Kontrollér konfiguration, anonym adgang og databasetabellen."); }); return () => { active = false; }; }, []);
  const builtinDictionarySettings = useMemo(() => parseBuiltinDictionarySettings(data?.[STORAGE_KEYS.builtinDictionarySettings]), [data?.[STORAGE_KEYS.builtinDictionarySettings]]);
  const dictionaryValue = data?.[STORAGE_KEYS.dictionaries] ?? (Array.isArray(data?.[STORAGE_KEYS.legacyDictionary]) ? [{ id: "default", name: "Egen ordbog", enabled: true, entries: data[STORAGE_KEYS.legacyDictionary] }] : []);
  const legacyDictionaryValue = data?.[STORAGE_KEYS.legacyDictionary];
  const hasSpacedCustomEntries = (Array.isArray(dictionaryValue) && dictionaryValue.some(item => item && typeof item === "object" && "entries" in item && Array.isArray(item.entries) && item.entries.some((entry: unknown) => entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word))))
    || (Array.isArray(legacyDictionaryValue) && legacyDictionaryValue.some((entry: unknown) => entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word)));
  const sharedDictionaryValue = Array.isArray(data?.__shared_dictionaries) ? data.__shared_dictionaries as SharedDictionary[] : [];
  const userId = typeof data?.__user_id === "string" ? data.__user_id : "";
  const hasSpacedOwnedSharedEntries = sharedDictionaryValue.some(row => row.owner_id === userId && Array.isArray(row.entries) && row.entries.some((entry: unknown) => entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word)));
  async function persist(key: string, value: unknown) {
    await savePersistedValue(key, value);
    setData(current => current ? { ...current, [key]: value } : current);
    setStorageError("");
  }
  useEffect(() => {
    if (!data || !hasSpacedCustomEntries || !Array.isArray(dictionaryValue)) return;
    const cleaned = dictionaryValue.map(item => item && typeof item === "object" && "entries" in item && Array.isArray(item.entries)
      ? { ...item, entries: item.entries.filter((entry: unknown) => !(entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word))) }
      : item);
    const writes = [persist(STORAGE_KEYS.dictionaries, cleaned)];
    if (Array.isArray(legacyDictionaryValue)) {
      const cleanedLegacy = legacyDictionaryValue.filter((entry: unknown) => !(entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word)));
      if (cleanedLegacy.length !== legacyDictionaryValue.length) writes.push(persist(STORAGE_KEYS.legacyDictionary, cleanedLegacy));
    }
    void Promise.all(writes).catch(() => setStorageError("Ordbøgerne kunne ikke gemmes i Supabase."));
  }, [data, hasSpacedCustomEntries]);
  useEffect(() => {
    if (!data || !userId || !hasSpacedOwnedSharedEntries) return;
    const cleanedRows = sharedDictionaryValue.filter(row => row.owner_id === userId && Array.isArray(row.entries) && row.entries.some((entry: unknown) => entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word))).map(row => ({
      ...row,
      entries: (row.entries as unknown[]).filter(entry => !(entry && typeof entry === "object" && "word" in entry && typeof entry.word === "string" && /\s/.test(entry.word))),
    }));
    void Promise.all(cleanedRows.map(row => setSharedDictionary({ id: row.id, name: row.name, entries: row.entries }))).then(() => {
      setData(current => current ? { ...current, __shared_dictionaries: (Array.isArray(current.__shared_dictionaries) ? current.__shared_dictionaries as SharedDictionary[] : []).map(row => cleanedRows.find(cleaned => cleaned.id === row.id) ?? row) } : current);
    }).catch(() => setStorageError("Delte ordbøger kunne ikke gemmes i Supabase."));
  }, [data, hasSpacedOwnedSharedEntries]);
  if (!data) return <main className="app-shell">{storageError ? <p role="alert">{storageError}</p> : <p>Opretter forbindelse til Supabase…</p>}</main>;
  const dictionaries = parseCustomDictionaries(dictionaryValue);
  const sharedDictionaries = sharedDictionaryValue;
  const library = [...validLibrary(data[LIBRARY_KEY]), ...validPublicLibrary(data.__public_crosswords)];
  const drafts = Array.isArray(data[DRAFTS_KEY]) ? data[DRAFTS_KEY] as Draft[] : [];
  const play = data[STORAGE_KEYS.play] as { active?: { id: string; puzzle: Puzzle; answers: Record<string, string> }; games?: Record<string, { id: string; puzzle: Puzzle; answers: Record<string, string> }> } | undefined;
  const updateDictionaries = (next: CustomDictionary[]) => { void persist(STORAGE_KEYS.dictionaries, next).catch(() => setStorageError("Ordbøgerne kunne ikke gemmes i Supabase.")); };
  const updateSharedDictionary = async (item: CustomDictionary, share: boolean) => {
    try {
      const existingShareId = item.shareId ?? item.id;
      const shareId = item.shareId ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id) ? item.id : crypto.randomUUID());
      if (share) {
        await setSharedDictionary({ id: shareId, name: item.name, entries: item.entries });
        const nextDictionaries = dictionaries.map(dictionary => dictionary.id === item.id ? { ...item, shareId } : dictionary);
        await savePersistedValue(STORAGE_KEYS.dictionaries, nextDictionaries);
        setData(current => current ? { ...current, [STORAGE_KEYS.dictionaries]: nextDictionaries, __shared_dictionaries: [...(Array.isArray(current.__shared_dictionaries) ? current.__shared_dictionaries as SharedDictionary[] : []).filter(row => row.id !== shareId), { id: shareId, name: item.name, entries: item.entries, owner_id: userId }] } : current);
      } else {
        await setSharedDictionary(null, existingShareId);
        const nextDictionaries = dictionaries.map(dictionary => dictionary.id === item.id ? { ...item, shareId: undefined } : dictionary);
        await savePersistedValue(STORAGE_KEYS.dictionaries, nextDictionaries);
        setData(current => current ? { ...current, [STORAGE_KEYS.dictionaries]: nextDictionaries, __shared_dictionaries: (Array.isArray(current.__shared_dictionaries) ? current.__shared_dictionaries as SharedDictionary[] : []).filter(row => row.id !== existingShareId) } : current);
      }
      setStorageError("");
    } catch { setStorageError(share ? "Ordbogen kunne ikke deles." : "Delingen kunne ikke stoppes."); }
  };  const updateBuiltinDictionarySettings = (next: BuiltinDictionarySettings) => {
    setData(current => current ? { ...current, [STORAGE_KEYS.builtinDictionarySettings]: next } : current);
    void savePersistedValue(STORAGE_KEYS.builtinDictionarySettings, next).then(() => setStorageError("")).catch(() => setStorageError("Ordbogsvalgene kunne ikke gemmes i Supabase."));
  };
  async function publishPuzzle(puzzle: Puzzle, name: string) {
    const publishedPuzzle = await publishPublicCrossword(name, puzzle);
    setData(current => current ? { ...current, __public_crosswords: [...(Array.isArray(current.__public_crosswords) ? current.__public_crosswords as PublicCrossword[] : []), publishedPuzzle] } : current);
    setJustPublished(true);
  }
  const published = library.at(-1)?.puzzle ?? null;
  return <><nav className="site-nav" aria-label="Vælg side"><button aria-current={page === "player" ? "page" : undefined} onClick={() => setPage("player")}>Løs krydsord</button><button aria-current={page === "designer" ? "page" : undefined} onClick={() => { setJustPublished(false); setPage("designer"); }}>Designerværksted</button></nav>{storageError && <p role="alert">{storageError}</p>}<div hidden={page !== "player"}>{page === "player" && <Player published={published} library={library} preferPublished={justPublished} dictionaries={dictionaries} onDictionariesChange={updateDictionaries} builtinDictionarySettings={builtinDictionarySettings} onBuiltinDictionarySettingsChange={updateBuiltinDictionarySettings} savedPlay={play} onPlayChange={savePlay} />}</div><div hidden={page !== "designer"}><Designer dictionaries={dictionaries} onDictionariesChange={updateDictionaries} sharedDictionaries={sharedDictionaries} userId={userId} onSharedDictionaryChange={updateSharedDictionary} builtinDictionarySettings={builtinDictionarySettings} onBuiltinDictionarySettingsChange={updateBuiltinDictionarySettings} onPublish={publishPuzzle} drafts={drafts} onDraftsChange={next => persist(DRAFTS_KEY, next).catch(error => { setStorageError("Kladderne kunne ikke gemmes i Supabase."); throw error; })} onPreview={puzzle => { setPreview(puzzle); setPage("preview"); }} /></div>{page === "preview" && preview && <><div className="preview-notice"><strong>Forhåndsvisning af kladde</strong><span>Krydsordet er ikke udgivet. Her kan du se feltet og ledetrådene, som spilleren vil se dem.</span><button onClick={() => setPage("designer")}>Tilbage til designeren</button></div><Player published={preview} preview dictionaries={dictionaries} onDictionariesChange={updateDictionaries} builtinDictionarySettings={builtinDictionarySettings} onBuiltinDictionarySettingsChange={updateBuiltinDictionarySettings} savedPlay={play} onPlayChange={savePlay} /></>}</>;
}
function Designer({ onPublish, onPreview, dictionaries, onDictionariesChange, sharedDictionaries, userId, onSharedDictionaryChange, builtinDictionarySettings, onBuiltinDictionarySettingsChange, drafts, onDraftsChange }: { onPublish: (puzzle: Puzzle, name: string) => Promise<void>; onPreview: (puzzle: Puzzle) => void; dictionaries: CustomDictionary[]; onDictionariesChange: (next: CustomDictionary[]) => void; sharedDictionaries: SharedDictionary[]; userId: string; onSharedDictionaryChange: (dictionary: CustomDictionary, share: boolean) => Promise<void>; builtinDictionarySettings: BuiltinDictionarySettings; onBuiltinDictionarySettingsChange: (next: BuiltinDictionarySettings) => void; drafts: Draft[]; onDraftsChange: (next: Draft[]) => Promise<void> }) {
  const builtinEntries = useMemo(() => dictionary.filter(entry => entry.source !== "custom" && builtinDictionarySettings[entry.source]), [builtinDictionarySettings]);
  const entries = useMemo(() => [...dictionaries.filter(item => item.enabled).flatMap(item => item.entries), ...builtinEntries], [dictionaries, builtinEntries]);
  const autofillEntries = entries;
  const allEntries = useMemo(() => [...dictionaries.flatMap(item => item.entries), ...dictionary], [dictionaries]);
  const [panelWidth, setPanelWidth] = useState(70);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [dictionaryPanelWidth, setDictionaryPanelWidth] = useState(38);
  const dictionaryWorkspaceRef = useRef<HTMLDivElement>(null);
  const [dictionaryId, setDictionaryId] = useState(dictionaries[0]?.id ?? "");
  const [browseDictionary, setBrowseDictionary] = useState<{ id: string; name: string; entries: DictionaryEntry[] } | null>(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryPage, setEntryPage] = useState(0);
  const [entrySortBy, setEntrySortBy] = useState<"word" | "clue">("word");
  const [entrySortDirection, setEntrySortDirection] = useState<"asc" | "desc">("asc");
  const [designerTab, setDesignerTab] = useState<"workshop" | "dictionaries">("workshop");
  const currentDictionary = dictionaries.find(item => item.id === dictionaryId) ?? dictionaries[0];
  const sortedDictionaryEntries = useMemo(() => currentDictionary ? currentDictionary.entries.filter(entry => `${entry.word} ${entry.clue}`.toLocaleLowerCase("da-DK").includes(entrySearch.trim().toLocaleLowerCase("da-DK"))).sort((a, b) => {
    const primary = entrySortBy === "word" ? a.word.localeCompare(b.word, "da") : a.clue.localeCompare(b.clue, "da");
    const secondary = entrySortBy === "word" ? a.clue.localeCompare(b.clue, "da") : a.word.localeCompare(b.word, "da");
    return (primary || secondary) * (entrySortDirection === "asc" ? 1 : -1);
  }) : [], [currentDictionary, entrySearch, entrySortBy, entrySortDirection]);
  const safeEntryPage = Math.min(entryPage, Math.max(0, Math.ceil(sortedDictionaryEntries.length / 40) - 1));
  const [newName, setNewName] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const wordScores = useMemo(() => indexWordScores(entries), [entries]);

  const [draftId, setDraftId] = useState("");
  const [designName, setDesignName] = useState("");
  const [size, setSize] = useState(9);
  const [includeImage, setIncludeImage] = useState(false);
  const [includeEmojiCues, setIncludeEmojiCues] = useState(false);
  const gridGenerationEntries = useMemo(() => includeEmojiCues && builtinDictionarySettings.emoji
    ? autofillEntries
    : autofillEntries.filter(entry => entry.source !== "emoji"), [includeEmojiCues, builtinDictionarySettings.emoji, autofillEntries]);
  const [imageWidth, setImageWidth] = useState(2);
  const [imageHeight, setImageHeight] = useState(2);
  const [includeHyphenatedWords, setIncludeHyphenatedWords] = useState(true);
  const [forcedHyphenatedWordCount, setForcedHyphenatedWordCount] = useState(0);
  const [illustration, setIllustration] = useState("preset:landscape");
  const [layout, setLayout] = useState<GridLayout>(() => ({ width: 9, height: 9, clues: [], images: [], words: [], blocks: [], arrows: [] }));
  const [initialGeneration, setInitialGeneration] = useState(true);
  const [selectedId, setSelectedId] = useState(layout.words[0]?.id);
  const [direction, setDirection] = useState<"across" | "down">(layout.words[0]?.direction ?? "across");
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [forcedWords, setForcedWords] = useState<DictionaryEntry[]>([]);
  const [forcedStatus, setForcedStatus] = useState("");
  const solverEntries = useMemo(() => forcedWords.length ? [...autofillEntries, ...forcedWords] : autofillEntries, [autofillEntries, forcedWords]);
  const requiredWords = useMemo(() => forcedWords.map(entry => entry.word), [forcedWords]);
  const [suggestions, setSuggestions] = useState<{ entry: DictionaryEntry; clues: { clue: string; score: number }[] }[]>([]);
  const suggestionSolutions = useRef<SuggestionSolutionBatch[]>([]);
  const generatedSolution = useRef<{ layout: GridLayout; dictionary: DictionaryEntry[]; answers: Record<string, DictionaryEntry> } | null>(null);
  const backgroundSolutions = useRef<{ layout: GridLayout; dictionary: DictionaryEntry[]; letters: Record<string, string>; answers: Record<string, DictionaryEntry>[] } | null>(null);
  const [backgroundStatus, setBackgroundStatus] = useState<{ count: number; average: number; minimum: number | null; perWord: Record<string, number>; state: "idle" | "searching" | "finished" | "error" }>({ count: 0, average: 0, minimum: 0, perWord: {}, state: "idle" });
  const [suggestionSort, setSuggestionSort] = useState<"score" | "alphabetical">("score");
  const [showEachWordOnce, setShowEachWordOnce] = useState(false);
  const [showGridCounts, setShowGridCounts] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0, uncertain: 0, done: false });
  const [clues, setClues] = useState<Record<string, string>>({});
  const [editingClueId, setEditingClueId] = useState<string | null>(null);
  const [inlineClueId, setInlineClueId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState("");
  const [text, setText] = useState("");
  const [useBothDictionaryDirections, setUseBothDictionaryDirections] = useState(false);
  const [clueFirstDictionaryFormat, setClueFirstDictionaryFormat] = useState(false);
  const [message, setMessage] = useState("");
  const [tool, setTool] = useState<"write" | "autofill" | "edit-clue" | LayoutTool>("write");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [imageDrag, setImageDrag] = useState<{ start: { row: number; col: number }; end: { row: number; col: number } } | null>(null);
  const imageDragRef = useRef<typeof imageDrag>(null);
  const imagePanRef = useRef<{ row: number; col: number; x: number; y: number; offsetX: number; offsetY: number; availableX: number; availableY: number } | null>(null);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [autofillProgress, setAutofillProgress] = useState<string | null>(null);
  const generationWorker = useRef<Worker | null>(null);
  const issues = useMemo(() => layoutIssues(layout), [layout]);
  const layoutErrors = useMemo(() => issues.map(issue => issue.message), [issues]);
  const searchLayout = useMemo(() => solverLayout(layout), [layout]);
  const searchErrors = useMemo(() => validateSolverLayout(layout), [layout]);
  const problemCells = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const issue of issues) for (const cell of issue.cells) {
      const key = keyOf(cell.row, cell.col);
      const messages = result.get(key) ?? new Set<string>();
      messages.add(describeLayoutError(issue.message, layout));
      result.set(key, messages);
    }
    return result;
  }, [issues, layout]);
  const selectedImage = layout.images.find(image => image.id === selectedImageId);
  const selected = layout.words.find(word => word.id === selectedId);
  const selectedKeys = new Set(selected ? wordCells(selected).map(cell => keyOf(cell.row, cell.col)) : []);
  const sortedSuggestions = [...suggestions].sort((a, b) => suggestionSort === "score"
    ? (wordScores.get(b.entry.word) ?? 0) - (wordScores.get(a.entry.word) ?? 0) || a.entry.word.localeCompare(b.entry.word, "da")
    : a.entry.word.localeCompare(b.entry.word, "da"));
  const sortedSuggestionClues = suggestions.flatMap(({ entry, clues }) => clues.map(item => ({ entry, ...item }))).sort((a, b) => suggestionSort === "score"
    ? b.score - a.score || a.entry.word.localeCompare(b.entry.word, "da") || a.clue.localeCompare(b.clue, "da")
    : a.entry.word.localeCompare(b.entry.word, "da") || a.clue.localeCompare(b.clue, "da"));
  const byCell = useMemo(() => {
    const result = new Map<string, GridWord[]>();
    searchLayout.words.forEach(word => wordCells(word).forEach(cell => { const key = keyOf(cell.row, cell.col); result.set(key, [...(result.get(key) ?? []), word]); }));
    return result;
  }, [searchLayout]);
  useEffect(() => {
    if (searchErrors.length || !searchLayout.words.length) { backgroundSolutions.current = null; setBackgroundStatus({ count: 0, average: 0, minimum: 0, perWord: {}, state: "idle" }); return; }
    const previous = backgroundSolutions.current;
    const candidates = previous?.layout === searchLayout && previous.dictionary === autofillEntries
      && Object.entries(previous.letters).every(([cell, letter]) => !letter || letters[cell] === letter)
      ? [...previous.answers] : [];
    for (const saved of suggestionSolutions.current) {
      if (saved.layout === searchLayout && saved.dictionary === autofillEntries
        && Object.entries(saved.baseLetters).every(([cell, letter]) => !letter || letters[cell] === letter)) {
        candidates.push(...saved.solutions.map(solution => solution.answers));
      }
    }
    if (generatedSolution.current?.layout === layout && generatedSolution.current.dictionary === gridGenerationEntries) candidates.push(generatedSolution.current.answers);
    const dictionaryWords = new Set(solverEntries.map(entry => entry.word));
    const retained: Record<string, DictionaryEntry>[] = [];
    for (const answers of candidates) {
        const assignments = new Map<string, string>();
        let valid = true;
        for (const word of searchLayout.words) {
          const answer = answers[word.id]?.word;
          if (!answer || !dictionaryWords.has(answer)) { valid = false; break; }
          wordCells(word).forEach((cell, i) => assignments.set(keyOf(cell.row, cell.col), answerLetters(answer)[i]));
        }
        if (valid && Object.entries(letters).every(([cell, letter]) => !letter || assignments.get(cell) === letter)
          && requiredWords.every(word => Object.values(answers).some(entry => entry.word === word))
          && !retained.some(existing => searchLayout.words.every(word => existing[word.id]?.word === answers[word.id]?.word))) retained.push(answers);
        if (retained.length >= 256) break;
    }
    const batch = { layout: searchLayout, dictionary: autofillEntries, letters: { ...letters }, answers: retained };
    backgroundSolutions.current = batch;
    const updateStatus = (state: "searching" | "finished" | "error") => {
      const counts = searchLayout.words.map(word => new Set(batch.answers.map(answers => answers[word.id]?.word).filter(Boolean)).size);
      const total = counts.reduce((sum, count) => sum + count, 0);
      const incompleteCounts = counts.filter((_, i) => wordCells(searchLayout.words[i]).some(cell => !letters[keyOf(cell.row, cell.col)]));
      setBackgroundStatus({ count: batch.answers.length, average: total / counts.length, minimum: incompleteCounts.length ? Math.min(...incompleteCounts) : null, perWord: Object.fromEntries(searchLayout.words.map((word, i) => [word.id, counts[i]])), state });
    };
    updateStatus("searching");
    const worker = new Worker(new URL("./crossword/backgroundSolutions.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      if (event.data.type === "solution" && backgroundSolutions.current === batch) {
        const answers = event.data.answers as Record<string, DictionaryEntry>;
        if (!batch.answers.some(existing => searchLayout.words.every(word => existing[word.id]?.word === answers[word.id]?.word))) {
          if (batch.answers.length >= 256) batch.answers.shift();
          batch.answers.push(answers);
          updateStatus("searching");
        }
      }
      if (event.data.type === "done" && backgroundSolutions.current === batch) updateStatus("finished");
    };
    worker.onerror = () => { if (backgroundSolutions.current === batch) updateStatus("error"); };
    worker.postMessage({ layout: searchLayout, entries: solverEntries, letters, knownSolutions: retained, requiredWords });
    return () => { worker.terminate(); };
  }, [layout, searchLayout, solverEntries, letters, searchErrors, requiredWords]);
  useEffect(() => {
    setSuggestions([]); setProgress({ checked: 0, total: 0, uncertain: 0, done: false });
    if (!selectedId || !searchLayout.words.some(word => word.id === selectedId) || searchErrors.length) return;
    const priorBatches = suggestionSolutions.current.filter(batch => batch.layout === searchLayout && batch.dictionary === autofillEntries && batch.suggestionDictionary === entries && batch.selected === selectedId);
    const applicable = priorBatches.filter(batch => Object.entries(batch.baseLetters).every(([cell, letter]) => !letter || letters[cell] === letter));
    const sameLetters = (base: Record<string, string>) => Object.entries(base).every(([cell, letter]) => (letters[cell] || "") === letter)
      && Object.entries(letters).every(([cell, letter]) => (base[cell] || "") === letter);
    const generated = generatedSolution.current;
    const knownSolutions = applicable.flatMap(batch => batch.solutions.map(solution => solution.answers));
    if (generated?.layout === layout && generated.dictionary === gridGenerationEntries) knownSolutions.unshift(generated.answers);
    const background = backgroundSolutions.current;
    if (background?.layout === searchLayout && background.dictionary === autofillEntries) knownSolutions.unshift(...background.answers);
    const unsatisfiableCandidates = applicable.filter(batch => batch.requiredKey === JSON.stringify([...requiredWords].sort()) && sameLetters(batch.baseLetters)).flatMap(batch => batch.unsatisfiableCandidates);
    const solutionBatch: SuggestionSolutionBatch = { layout: searchLayout, dictionary: autofillEntries, suggestionDictionary: entries, selected: selectedId, baseLetters: { ...letters }, requiredKey: JSON.stringify([...requiredWords].sort()), solutions: [], unsatisfiableCandidates: [], complete: false };
    suggestionSolutions.current = [...suggestionSolutions.current.filter(batch => batch.layout === searchLayout && batch.dictionary === autofillEntries && batch.suggestionDictionary === entries), solutionBatch].slice(-24);
    const worker = new Worker(new URL("./crossword/suggestions.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const data = event.data;
      if (data.type === "candidate") {
        setSuggestions(current => [...current, { entry: data.entry, clues: data.clues }]);
        solutionBatch.solutions.push({ answers: data.answers });
      } else if (data.type === "rejected") {
        solutionBatch.unsatisfiableCandidates.push(data.word);
      } else {
        if (data.type === "done") {
          solutionBatch.unsatisfiableCandidates = data.unsatisfiableCandidates;
          solutionBatch.complete = true;
        }
        setProgress({ checked: data.checked, total: data.total, uncertain: data.uncertain, done: data.type === "done" });
      }
    };
    worker.postMessage({ layout: searchLayout, entries, solverEntries: solverEntries, selected: selectedId, letters, knownSolutions, unsatisfiableCandidates: requiredWords.length ? [] : unsatisfiableCandidates, requiredWords });
    return () => worker.terminate();
  }, [layout, searchLayout, entries, solverEntries, selectedId, letters, searchErrors, requiredWords]);
  useEffect(() => {
    setForcedStatus("");
    if (!requiredWords.length || searchErrors.length || !searchLayout.words.length) return;
    const worker = new Worker(new URL("./crossword/forcedWords.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const { placements, unavailable, unresolved } = event.data as { placements: { id: string; entry: DictionaryEntry }[]; unavailable: string[]; unresolved: string[] };
      setForcedStatus(unavailable.length ? `Ingen løsning fundet med de fastlagte ord (${unavailable.join(", ")}).` : unresolved.length ? `Placeringen kunne ikke afgøres inden for beregningsgrænsen (${unresolved.join(", ")}).` : "");
      if (!placements.length) return;
      const next = { ...letters };
      for (const { id, entry } of placements) {
        const word = searchLayout.words.find(item => item.id === id);
        if (word) wordCells(word).forEach((cell, i) => { next[keyOf(cell.row, cell.col)] = answerLetters(entry.word)[i]; });
      }
      if (Object.keys(next).some(key => next[key] !== letters[key])) {
        updateLetters(next);
        setLayoutMessage("Et fastlagt ord er indsat, fordi det kun har én mulig placering.");
      }
    };
    worker.postMessage({ layout: searchLayout, entries: solverEntries, letters, forcedWords, knownSolutions: backgroundSolutions.current?.answers ?? [] });
    return () => worker.terminate();
  }, [searchLayout, solverEntries, letters, forcedWords, searchErrors]);
  useEffect(() => {
    if (!imageDrag) return;
    const finish = () => finishImageArea();
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [!!imageDrag]);
  const autofillWorker = useRef<Worker | null>(null);
  useEffect(() => () => { if (autofillWorker.current) { autofillWorker.current.terminate(); autofillWorker.current = null; setAutofillProgress(null); } }, [layout, solverEntries, letters, requiredWords]);
  function cancelAutofill() {
    autofillWorker.current?.terminate(); autofillWorker.current = null;
    setAutofillProgress(null); setLayoutMessage("Søgningen blev afbrudt.");
  }
  function startAutofill(id?: string, checkOnly = false) {
    if (searchErrors.length || (id && !searchLayout.words.some(word => word.id === id))) { setLayoutMessage("Tilføj et ord med en ledetråd, og ret eventuelle problemer med ordet før søgning."); return; }
    autofillWorker.current?.terminate();
    const worker = new Worker(new URL("./crossword/autofill.worker.ts", import.meta.url), { type: "module" });
    autofillWorker.current = worker;
    setLayoutMessage(checkOnly ? "Kontrollerer, om ordene med ledetråd kan udfyldes …" : "Søger efter den bedste udfyldning …");
    setAutofillProgress(checkOnly ? "Kontrollerer mulige løsninger …" : id ? "Undersøger ord …" : "Undersøger muligheder …");
    worker.onmessage = event => {
      const result = event.data;
      if (result.type === "progress") {
        setAutofillProgress(result.mode === "check"
          ? `${result.nodes.toLocaleString("da-DK")} søgetrin undersøgt${result.solutions ? ` · ${result.solutions} løsning fundet` : ""}.`
          : result.mode === "grid"
            ? `${result.nodes.toLocaleString("da-DK")} søgetrin undersøgt · ${result.solutions.toLocaleString("da-DK")} gyldige løsninger fundet${result.bestScore === null ? "" : ` · bedste score: ${result.bestScore} point`}. Antallet er fundne løsninger, ikke det samlede antal.`
            : `${result.checked.toLocaleString("da-DK")} af ${result.total.toLocaleString("da-DK")} ord undersøgt · ${result.uncertain} uafklarede · ${result.nodes.toLocaleString("da-DK")} søgetrin for det aktuelle ord.`);
        return;
      }
      worker.terminate(); autofillWorker.current = null;
      if (checkOnly) {
        const stats = result.searchStats as { nodes?: number } | undefined;
        const nodes = stats?.nodes ?? 0;
        const summary = result.status === "solved"
          ? "Alle ord med ledetråd kan udfyldes med de valgte ordbøger."
          : result.status === "limit"
            ? "Beregningsgrænsen blev nået uden en bekræftet fuld løsning. Feltet er stadig uafklaret."
            : result.status === "invalid"
              ? "Feltets opbygning skal rettes, før det kan kontrolleres."
              : "Der blev ikke fundet en fuld løsning med de valgte ordbøger.";
        setLayoutMessage(summary);
        setAutofillProgress(`Kontrollen brugte ${nodes.toLocaleString("da-DK")} søgetrin. Ingen bogstaver blev ændret.`);
        return;
      }
      if (id && result.searchStats) {
        const stats = result.searchStats as { checked: number; total: number; uncertain: number; nodes: number; reused?: boolean };
        const summary = stats.reused
          ? result.status === "solved" ? "En tidligere bekr\u00e6ftet l\u00f8sning blev genbrugt." : "En tidligere bekr\u00e6ftet l\u00f8sning blev genbrugt; et h\u00f8jere prioriteret ord er stadig uafklaret."
          : result.status === "solved"
            ? `Bedste ord fundet efter at have afpr\u00f8vet ${stats.checked} af ${stats.total} kandidater. De resterende blev sprunget over, fordi ordene afpr\u00f8ves i scoreorden.`
            : result.answers
              ? `Et muligt ord blev fundet efter ${stats.checked} af ${stats.total} kandidater. ${stats.uncertain} kandidater med h\u00f8jere prioritet var uafklarede, s\u00e5 det er ikke sikkert, at ordet har den h\u00f8jeste score.`
              : `Afpr\u00f8vet ${stats.checked} af ${stats.total} kandidater; ${stats.uncertain} var uafklarede. Der blev ikke fundet en bekr\u00e6ftet l\u00f8sning.`;
        setAutofillProgress(`${summary} Sidste søgning: ${stats.nodes.toLocaleString("da-DK")} søgetrin.`);
      }
      if (!result.answers) { setLayoutMessage(result.status === "limit" ? "Beregningsgrænsen blev nået uden en bekræftet løsning. Prøv med flere bogstaver." : "Ingen udfyldning passer til de nuværende bogstaver."); return; }
      const next = { ...letters };
      for (const word of layout.words) {
        const entry = result.answers[word.id] as DictionaryEntry | undefined;
        if (entry) wordCells(word).forEach((cell, i) => { next[keyOf(cell.row, cell.col)] = answerLetters(entry.word)[i]; });
      }
      updateLetters(next);
      setLayoutMessage(result.status === "limit" ? (id ? "Et gyldigt ord er indsat. Nogle højere prioriterede ord kunne ikke afklares inden for beregningsgrænsen." : "Den bedste fundne løsning er indsat. Beregningsgrænsen blev nået, så en højere score kan være mulig.") : id ? "Ordet er autofyldt." : "Feltet er udfyldt med højest mulig samlet ordscore.");
    };
    const compatibleBatches = id && !checkOnly ? suggestionSolutions.current
      .filter(batch => batch.complete && batch.requiredKey === JSON.stringify([...requiredWords].sort()) && batch.layout === searchLayout && batch.dictionary === autofillEntries && batch.suggestionDictionary === entries
        && Object.entries(batch.baseLetters).every(([cell, letter]) => letters[cell] === letter))
      .sort((a, b) => Object.keys(b.baseLetters).length - Object.keys(a.baseLetters).length) : [];
    const knownSolutions = compatibleBatches.flatMap(batch => batch.solutions);
    if (generatedSolution.current?.layout === layout && generatedSolution.current.dictionary === gridGenerationEntries) knownSolutions.unshift({ answers: generatedSolution.current.answers });
    if (backgroundSolutions.current?.layout === searchLayout && backgroundSolutions.current.dictionary === autofillEntries) knownSolutions.unshift(...backgroundSolutions.current.answers.map(answers => ({ answers })));
    const unsatisfiableCandidates = compatibleBatches.filter(batch => batch.selected === id).flatMap(batch => batch.unsatisfiableCandidates);
    worker.postMessage({ layout: searchLayout, entries: solverEntries, letters, selected: id, checkOnly, knownSolutions, unsatisfiableCandidates: requiredWords.length ? [] : unsatisfiableCandidates, requiredWords });
  }
  function emptyLayout() {
    generationWorker.current?.terminate(); generationWorker.current = null;
    autofillWorker.current?.terminate(); autofillWorker.current = null;
    setForcedWords([]); setDraftId(""); setDesignName(""); setLayout({ width: size, height: size, clues: [], images: [], words: [], blocks: [], arrows: [] });
    setSelectedId(""); setDirection("across"); setSelectedCell(null); setSelectedImageId(null);
    setLetters({}); setClues({}); setPublishMessage(""); setAutofillProgress(null); setTool("clue");
    setLayoutMessage("Tomt felt oprettet. Placér en ledetråd for at begynde.");
  }
  function newLayout() {
    generationWorker.current?.terminate();
    const worker = new Worker(new URL("./crossword/designerGeneration.worker.ts", import.meta.url), { type: "module" });
    generationWorker.current = worker;
    setLayoutMessage("Leder efter et varieret felt, som kan udfyldes …");
    setAutofillProgress("Afprøver layout og komplette udfyldninger …");
    worker.onmessage = event => {
      const result = event.data;
      if (result.type === "progress") {
        setAutofillProgress(`Layout ${result.attempt} af ${result.attempts} · ${result.nodes.toLocaleString("da-DK")} søgetrin${result.limited ? " · søgegrænsen blev nået" : ""}.`);
        return;
      }
      worker.terminate(); generationWorker.current = null;
      setInitialGeneration(false);
      setAutofillProgress(null);
      if (result.type === "failed") {
        setLayoutMessage(result.limited
          ? `Ingen af ${result.attempts} layoutforsøg blev bekræftet som løselige; ${result.limited} søgninger nåede grænsen. Det nuværende felt er bevaret. Prøv igen eller aktivér flere ordbøger.`
          : `Ingen af ${result.attempts} layoutforsøg kunne udfyldes med de valgte ord. Det nuværende felt er bevaret. Prøv igen eller aktivér flere ordbøger.`);
        return;
      }
      const next = result.layout as GridLayout;
      generatedSolution.current = { layout: next, dictionary: gridGenerationEntries, answers: result.answers as Record<string, DictionaryEntry> };
      setForcedWords([]); setDraftId(""); setDesignName(""); setLayout(next); setSelectedId(next.words[0]?.id); setDirection(next.words[0]?.direction ?? "across"); setSelectedCell(null); setSelectedImageId(null); setLetters({}); setClues({}); setPublishMessage("");
      const messages = [];
      if (includeImage) messages.push(`Billedområde ${imageWidth} × ${imageHeight} er placeret.`);
      if (next.clues.some(cue => cue.emoji || cue.emojiAny)) messages.push(`${next.clues.filter(cue => cue.emoji || cue.emojiAny).length} emoji-ledetråd${next.clues.filter(cue => cue.emoji || cue.emojiAny).length === 1 ? "" : "e"} er placeret.`);
      if (next.words.some(word => word.breaks?.length)) messages.push("Feltet indeholder en separator til et svar med bindestreg.");
      setLayoutMessage(messages.join(" "));
    };
    worker.onerror = () => {
      worker.terminate();
      if (generationWorker.current === worker) generationWorker.current = null;
      setInitialGeneration(false);
      setAutofillProgress(null);
      setLayoutMessage("Feltgeneratoren stødte på en fejl. Det nuværende felt er bevaret; prøv igen.");
    };
    worker.postMessage({ size, entries: gridGenerationEntries, includeHyphenatedWords, includeEmojiCues: includeEmojiCues && builtinDictionarySettings.emoji, forcedHyphenatedWordCount: includeHyphenatedWords ? forcedHyphenatedWordCount : 0, previousLayout: layout,
      image: includeImage ? { width: imageWidth, height: imageHeight, illustration } : undefined });
  }
  useEffect(() => {
    newLayout();
    return () => { generationWorker.current?.terminate(); generationWorker.current = null; };
  }, []);
  function chooseDirection(next: "across" | "down") {
    if (autofillWorker.current) cancelAutofill();
    setDirection(next);
    const word = selectedCell && byCell.get(selectedCell)?.find(item => item.direction === next);
    if (word) setSelectedId(word.id);
  }
  function chooseCell(row: number, col: number) {
    const key = keyOf(row, col);
    const words = byCell.get(key) ?? [];
    if (!words.length) return;
    const word = words.find(item => item.direction === direction) ?? words[0];
    if (tool !== "autofill" && autofillWorker.current) cancelAutofill();
    setSelectedCell(key);
    setSelectedId(word.id);
    if (tool === "autofill") startAutofill(word.id);
  }
  function changeWordCue(target: GridWord, cueId: string) {
    const wordId = target.id;
    const current = layout.words.find(word => word.id === wordId);
    if (!current) {
      setLayout({ ...layout, words: [...layout.words, { ...target, clueId: cueId, textClueId: target.clueId }] });
      setPublishMessage("");
      return;
    }
    const toImage = layout.images.some(image => image.id === cueId);
    const removeAddedWord = !toImage && current.textClueId?.startsWith("missing-");
    const next = { ...layout, words: layout.words.filter(word => !removeAddedWord || word.id !== wordId).map(word => word.id !== wordId ? word : {
      ...word,
      clueId: cueId,
      ...(toImage ? { textClueId: word.textClueId ?? word.clueId } : { textClueId: undefined }),
    }) };
    setLayout(next);
    setPublishMessage("");
  }
  function updateLetters(next: Record<string, string>, choice?: { id: string; clue: string }) {
    const changed = new Set([...Object.keys(letters), ...Object.keys(next)].filter(key => letters[key] !== next[key]));
    const affected = new Set(layout.words.filter(word => wordCells(word).some(cell => changed.has(keyOf(cell.row, cell.col)))).map(word => word.id));
    setLetters(next);
    setClues(current => {
      const retained = Object.fromEntries(Object.entries(current).filter(([id]) => !affected.has(id)));
      if (choice) retained[choice.id] = choice.clue;
      return retained;
    });
  }
  function applyWord(word: string, clue: string) {
    if (!selected) return;
    const spelling = answerLetters(word);
    if (spelling.length !== selected.length) return;
    const next = { ...letters };
    wordCells(selected).forEach((cell, i) => { next[keyOf(cell.row, cell.col)] = spelling[i]; });
    updateLetters(next, { id: selected.id, clue });
  }
  function changeCell(row: number, col: number) {
    if (tool === "write" || tool === "autofill" || tool === "edit-clue") return;
    if (tool === "image-area") return;
    const next = editLayout(layout, { row, col }, tool, undefined, direction);
    if (!next) { setLayoutMessage("Feltet er for tæt på kanten til den valgte størrelse."); return; }
    const surviving = new Set(next.words.filter(word => {
      const old = layout.words.find(item => item.id === word.id);
      const oldCue = old && layout.clues.find(cue => cue.id === old.clueId);
      const nextCue = next.clues.find(cue => cue.id === word.clueId);
      const oldEmoji = oldCue?.emojiAny ? `any:${oldCue.emojiDirection ?? "both"}` : oldCue?.emoji;
      const nextEmoji = nextCue?.emojiAny ? `any:${nextCue.emojiDirection ?? "both"}` : nextCue?.emoji;
      return old && sameSlot(old, word) && oldEmoji === nextEmoji;
    }).map(word => word.id));
    setClues(current => Object.fromEntries(Object.entries(current).filter(([id]) => surviving.has(id))));
    setLetters(current => Object.fromEntries(Object.entries(current).filter(([key]) => {
      const [r, c] = key.split(",").map(Number);
      return !next.clues.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.images.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.blocks?.some(item => item.row === r && item.col === c)
        && !next.arrows?.some(item => item.row === r && item.col === c);
    })));
    if (tool === "emoji") setTool("write");
    if (tool.startsWith("image-")) {
      const chosen = illustration;
      next.images = next.images.map(area => area.row === row && area.col === col ? { ...area, illustration: chosen } : area);
    }
    setLayout(next);
    const searchableWords = solverLayout(next).words;
    setSelectedId(current => searchableWords.some(word => word.id === current) ? current : searchableWords[0]?.id ?? "");
    setPublishMessage("");
    setLayoutMessage("Feltet er ændret. Ledetråde til ændrede ord er ryddet.");
  }
  function applyImageArea(selection: NonNullable<typeof imageDrag>) {
    const row = Math.min(selection.start.row, selection.end.row);
    const col = Math.min(selection.start.col, selection.end.col);
    const width = Math.abs(selection.end.col - selection.start.col) + 1;
    const height = Math.abs(selection.end.row - selection.start.row) + 1;
    const next = editLayout(layout, { row, col }, "image-area", { width, height });
    if (!next) return;
    next.images = next.images.map(area => area.row === row && area.col === col && area.width === width && area.height === height ? { ...area, illustration } : area);
    const surviving = new Set(next.words.filter(word => {
      const old = layout.words.find(item => item.id === word.id);
      return old && sameSlot(old, word);
    }).map(word => word.id));
    setClues(current => Object.fromEntries(Object.entries(current).filter(([id]) => surviving.has(id))));
    setLetters(current => Object.fromEntries(Object.entries(current).filter(([cellKey]) => {
      const [r, c] = cellKey.split(",").map(Number);
      return !next.clues.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.images.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.blocks?.some(item => item.row === r && item.col === c)
        && !next.arrows?.some(item => item.row === r && item.col === c);
    })));
    setLayout(next);
    setSelectedId(current => next.words.some(word => word.id === current) ? current : next.words[0]?.id);
    setPublishMessage("");
    setLayoutMessage(`Billedområde på ${width} × ${height} felter er markeret.`);
    setTool("write");
  }
  function startImageArea(row: number, col: number) {
    if (tool !== "image-area") return;
    const existing = layout.images.find(area => row >= area.row && row < area.row + area.height && col >= area.col && col < area.col + area.width);
    if (existing) { setSelectedImageId(existing.id); return; }
    setSelectedImageId(null);
    const selection = { start: { row, col }, end: { row, col } };
    imageDragRef.current = selection;
    setImageDrag(selection);
  }
  function extendImageArea(row: number, col: number) {
    if (tool !== "image-area" || !imageDragRef.current) return;
    const selection = { ...imageDragRef.current, end: { row, col } };
    imageDragRef.current = selection;
    setImageDrag(selection);
  }
  function finishImageArea() {
    const selection = imageDragRef.current;
    imageDragRef.current = null;
    setImageDrag(null);
    if (selection) applyImageArea(selection);
  }
  function updateSelectedImage(changes: Partial<Pick<NonNullable<typeof selectedImage>, "fit" | "offsetX" | "offsetY" | "illustration">>) {
    if (!selectedImage) return;
    setLayout(current => ({ ...current, images: current.images.map(image => image.id === selectedImage.id ? { ...image, ...changes } : image) }));
    setPublishMessage("");
  }
  function resizeSelectedImage(width: number, height: number) {
    if (!selectedImage) return;
    const next = resizeImageArea(layout, selectedImage.id, width, height);
    if (!next) { setLayoutMessage("Billedområdet kan ikke ændres til den størrelse eller overlappe et andet billede."); return; }
    const surviving = new Set(next.words.filter(word => { const old = layout.words.find(item => item.id === word.id); return old && sameSlot(old, word); }).map(word => word.id));
    setClues(current => Object.fromEntries(Object.entries(current).filter(([id]) => surviving.has(id))));
    setLetters(current => Object.fromEntries(Object.entries(current).filter(([cellKey]) => {
      const [r, c] = cellKey.split(",").map(Number);
      return !next.clues.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.images.some(area => r >= area.row && r < area.row + area.height && c >= area.col && c < area.col + area.width)
        && !next.blocks?.some(item => item.row === r && item.col === c) && !next.arrows?.some(item => item.row === r && item.col === c);
    })));
    setLayout(next);
    setSelectedId(current => next.words.some(word => word.id === current) ? current : next.words[0]?.id);
    setLayoutMessage(`Billedområdet er nu ${width} × ${height} felter.`);
    setPublishMessage("");
  }
  function updateDictionary(next: CustomDictionary) {
    if (!next.shared && sharedDictionaries.some(row => row.id === (next.shareId ?? next.id) && row.owner_id === userId)) {
      void onSharedDictionaryChange(next, true);
      return;
    }
    onDictionariesChange(dictionaries.map(item => item.id === next.id ? next : item));
  }
  async function importDictionary(file: File) {
    try {
      const imported = parseDictionaryFile(await file.text());
      const item: CustomDictionary = { ...imported, id: crypto.randomUUID(), enabled: false };
      onDictionariesChange([...dictionaries, item]);
      setDictionaryId(item.id); setBrowseDictionary(null); setMessage(`Ordbogen ${item.name} er importeret og slået fra.`);
    } catch {
      setMessage("Filen kunne ikke importeres. Vælg en gyldig ordbogsfil fra Krydsværk.");
    }
  }
  function addWords() {
    const parsed = parseCustomEntries(text, useBothDictionaryDirections, clueFirstDictionaryFormat);
    if (!parsed || !currentDictionary) { setMessage("Skriv f.eks. Pigenavn: Hanne|Sigrid eller ORD;ledetråd."); return; }
    const merged = new Map(currentDictionary.entries.map(entry => [customEntryKey(entry), entry]));
    parsed.forEach(entry => merged.set(customEntryKey(entry), entry));
    updateDictionary({ ...currentDictionary, entries: [...merged.values()] });
    setText(""); setMessage(`${parsed.length} ord er gemt.`);
  }
  function transferEntry(entry: DictionaryEntry, targetId: string, move: boolean) {
    if (!currentDictionary || !targetId || targetId === currentDictionary.id) return;
    const target = dictionaries.find(item => item.id === targetId);
    if (!target) return;
    const key = customEntryKey(entry);
    const targetEntries = new Map(target.entries.map(item => [customEntryKey(item), item]));
    targetEntries.set(key, entry);
    onDictionariesChange(dictionaries.map(item => {
      if (item.id === target.id) return { ...item, entries: [...targetEntries.values()] };
      if (move && item.id === currentDictionary.id) return { ...item, entries: item.entries.filter(sourceEntry => customEntryKey(sourceEntry) !== key) };
      return item;
    }));
    setMessage(move ? `"${entry.word}" blev flyttet til ${target.name}.` : `"${entry.word}" blev kopieret til ${target.name}.`);
  }
  function saveEdit(key: string) {
    if (!currentDictionary) return;
    const parsed = parseCustomEntries(editText);
    if (!parsed || parsed.length !== 1) { setMessage("Skriv ét ord og én ledetråd som ORD;ledetråd."); return; }
    const merged = new Map(currentDictionary.entries.filter(entry => customEntryKey(entry) !== key).map(entry => [customEntryKey(entry), entry]));
    merged.set(customEntryKey(parsed[0]), parsed[0]);
    updateDictionary({ ...currentDictionary, entries: [...merged.values()] });
    setEditingKey(null); setMessage("Ordet er opdateret.");
  }
  function previewPuzzle() {
    if (layoutErrors.length || !layout.words.length) { setPublishMessage("Ret feltets opbygning før forhåndsvisning."); return; }
    const answers: Record<string, DictionaryEntry> = {};
    for (const word of layout.words) {
      const spelling = wordCells(word).map(cell => letters[keyOf(cell.row, cell.col)] ?? "?").join("");
      const cue = layout.clues.find(item => item.id === word.clueId);
      const appliesEmoji = Boolean((cue?.emoji || cue?.emojiAny) && (!cue.emojiDirection || cue.emojiDirection === word.direction));
      const matching = allEntries.filter(item => answerLetters(item.word) === spelling && fitsBreaks(word, item.word) && (!appliesEmoji || (item.source === "emoji" && (cue?.emojiAny || item.clue === cue?.emoji))));
      const entry = matching.find(item => item.clue === clues[word.id]) ?? matching[0];
      answers[word.id] = { word: entry?.word ?? spelling, length: word.length, clue: appliesEmoji && cue?.emoji ? cue.emoji : (appliesEmoji ? entry?.clue : clues[word.id]?.trim() || entry?.clue) || "", source: entry?.source ?? "custom" };
    }
    setPublishMessage("");
    onPreview(puzzleFromLayout(layout, answers));
  }
  async function saveDraft() {
    const name = designName.trim();
    if (!name) { setPublishMessage("Giv designet et navn før det gemmes."); return; }
    const id = draftId || crypto.randomUUID();
    const draft = { id, name, size: layout.width, layout, letters, clues, forcedWords };
    const next = [...drafts.filter(item => item.id !== id), draft];
    try { await onDraftsChange(next); setDraftId(id); setPublishMessage("Kladden er gemt i Supabase."); }
    catch { setPublishMessage("Kladden kunne ikke gemmes i Supabase."); }
  }
  function openDraft(id: string) {
    const draft = drafts.find(item => item.id === id);
    if (!draft) return;
    generationWorker.current?.terminate(); generationWorker.current = null;
    autofillWorker.current?.terminate(); autofillWorker.current = null;
    setDraftId(id); setDesignName(draft.name); setSize(draft.size); setLayout(draft.layout); setLetters(draft.letters); setClues(draft.clues); setForcedWords(draft.forcedWords ?? []);
    setSelectedId(draft.layout.words[0]?.id); setDirection(draft.layout.words[0]?.direction ?? "across"); setSelectedCell(null); setSelectedImageId(null); setTool("write"); setPublishMessage("Kladden er åbnet."); setLayoutMessage("");
  }
  function publish() {
    if (layoutErrors.length || !layout.words.length) { setPublishMessage("Ret feltets opbygning før udgivelse."); return; }
    const answers: Record<string, DictionaryEntry> = {};
    const used = new Set<string>();
    for (const word of layout.words) {
      const spelling = wordCells(word).map(cell => letters[keyOf(cell.row, cell.col)] ?? "").join("");
      if (spelling.length !== word.length) { setPublishMessage("Udfyld alle bogstavfelter før udgivelse."); return; }
      const cue = layout.clues.find(item => item.id === word.clueId);
      const appliesEmoji = Boolean((cue?.emoji || cue?.emojiAny) && (!cue.emojiDirection || cue.emojiDirection === word.direction));
      const matching = allEntries.filter(item => answerLetters(item.word) === spelling && fitsBreaks(word, item.word) && (!appliesEmoji || (item.source === "emoji" && (cue?.emojiAny || item.clue === cue?.emoji))));
      const entry = matching.find(item => item.clue === clues[word.id]) ?? matching[0];
      if (!entry) { setPublishMessage(appliesEmoji ? `Ordet ${spelling} passer ikke til emoji-ledetråden. Vælg et svar fra Emojiordbogen.` : `Ordet ${spelling} findes ikke i ordbogen. Tilføj det før udgivelse.`); return; }
      if (used.has(entry.word)) { setPublishMessage(`Ordet ${entry.word} er brugt flere gange.`); return; }
      used.add(entry.word);
      answers[word.id] = { ...entry, clue: appliesEmoji && cue?.emoji ? cue.emoji : appliesEmoji ? entry.clue : clues[word.id]?.trim() || entry.clue };
    }
    const puzzle = puzzleFromLayout(layout, answers);
    void onPublish(puzzle, designName.trim() || `Krydsord ${new Date().toLocaleString("da-DK")}`).then(() => setPublishMessage("Krydsordet er udgivet og kan ses af alle på forsiden.")).catch(() => setPublishMessage("Krydsordet kunne ikke udgives. Kontrollér forbindelsen til Supabase."));
  }
  const pattern = selected ? wordCells(selected).map((cell, i) => `${selected.breaks?.includes(i) ? "-" : ""}${letters[keyOf(cell.row, cell.col)] || "·"}`).join("") : "";
  return <div className="editor-shell">
    <SiteHeader edition="KRYDSORDSVÆRKSTED" homeTarget="#designer-top" />
    <main id="designer-top" className="editor-main"><fieldset className="designer-content" disabled={initialGeneration} aria-busy={initialGeneration}>
      <PageIntro eyebrow={designerTab === "workshop" ? "KONSTRUÉR ET KRYDSORD" : "DIT ORDARKIV"} title={designerTab === "workshop" ? <>Find de rigtige <em>ord.</em></> : <>Vælg dine <em>ordbøger.</em></>}>{designerTab === "workshop" ? "Vælg et ord i feltet, og se hvilke muligheder der kan føre til en samlet løsning." : "Vælg indbyggede samlinger, og vedligehold dine egne ord og ledetråde."}</PageIntro>

    <nav className="designer-tabs" aria-label="Designerens værktøjer"><button type="button" aria-current={designerTab === "workshop" ? "page" : undefined} onClick={() => setDesignerTab("workshop")}>Krydsord</button><button type="button" aria-current={designerTab === "dictionaries" ? "page" : undefined} onClick={() => setDesignerTab("dictionaries")}>Ordbøger <span>{dictionaries.length}</span></button></nav>
          {designerTab === "workshop" && <section className="designer-control-bar" aria-label="Indstillinger for krydsord">
        <div className="designer-control-group grid-setup"><PanelHeading number="01" label="GITTER" title="Opret et felt" level={3} /><div className="designer-control-row"><label htmlFor="size">Feltets størrelse</label><select id="size" value={size} onChange={event => setSize(Number(event.target.value))}><option value={9}>9 × 9</option><option value={11}>11 × 11</option><option value={13}>13 × 13</option></select><button type="button" className="secondary-action" onClick={newLayout}>Generér nyt felt</button><button type="button" className="secondary-action" onClick={emptyLayout}>Start med tomt felt</button></div>
          <details className="generator-settings"><summary>Indstillinger</summary><div className="designer-generator-options">
            <label><input type="checkbox" checked={includeHyphenatedWords} onChange={event => setIncludeHyphenatedWords(event.target.checked)} /> Brug ord med bindestreg, hvis muligt</label>
            <div className="generator-word-count"><label htmlFor="forced-hyphen-count">Antal svar med bindestreg</label><select id="forced-hyphen-count" value={forcedHyphenatedWordCount} disabled={!includeHyphenatedWords} onChange={event => setForcedHyphenatedWordCount(Number(event.target.value))}><option value={0}>Automatisk</option>{[1, 2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}</select></div>
            <label><input type="checkbox" checked={includeEmojiCues} disabled={!builtinDictionarySettings.emoji} onChange={event => setIncludeEmojiCues(event.target.checked)} /> Brug emoji-ledetråde ved oprettelse af nye felter</label>
            {!builtinDictionarySettings.emoji && <small className="generator-option-hint">Aktivér Emojiordbog under fanen Ordbøger for at bruge emoji-ledetråde.</small>}
            <label><input type="checkbox" checked={includeImage} onChange={event => setIncludeImage(event.target.checked)} /> Medtag billedområde</label>
            {includeImage && <div className="designer-image-size"><label>Bredde<select aria-label="Billedområdets bredde" value={imageWidth} onChange={event => setImageWidth(Number(event.target.value))}>{Array.from({ length: Math.min(5, size - 3) }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} felter</option>)}</select></label><label>Højde<select aria-label="Billedområdets højde" value={imageHeight} onChange={event => setImageHeight(Number(event.target.value))}>{Array.from({ length: Math.min(5, size - 3) }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} felter</option>)}</select></label></div>}
          </div></details>
        </div>
        <div className="designer-control-group draft-setup"><PanelHeading number="02" label="KLADDE" title="Gem dit arbejde" level={3} /><div className="designer-control-row"><input aria-label="Designets navn" value={designName} onChange={event => setDesignName(event.target.value)} placeholder="Navngiv designet" /><button type="button" className="secondary-action" onClick={saveDraft}>Gem kladde</button>{drafts.length > 0 && <select aria-label="Åbn gemt kladde" value={draftId} onChange={event => openDraft(event.target.value)}><option value="">Åbn gemt kladde</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.name}</option>)}</select>}</div></div>
        <div className="designer-control-group publish-setup"><PanelHeading number="03" label="UDGIV" title="Del dit krydsord" level={3} /><div className="designer-control-row"><button type="button" className="secondary-action" onClick={previewPuzzle}>Forhåndsvis</button><button type="button" className="primary-action" onClick={publish}>Udgiv krydsord</button></div></div>
        <p className="designer-control-status" role="status">{publishMessage}</p>
      </section>}
    {designerTab === "workshop" && <div className="editor-workspace" ref={workspaceRef} style={{ "--board-share": `${panelWidth}fr`, "--suggestion-share": `${100 - panelWidth}fr` } as CSSProperties}><section className="editor-board-panel"><PanelHeading number="01" label="FELT" title="Dit krydsord" />
    <div className="board-toolbar" role="region" aria-label="Rediger feltet">
      <div className="board-tool-groups">
        {[{ label: "Udfyld", items: tools.slice(0, 3) }, { label: "Felter", items: tools.slice(3, 10) }, { label: "Bindestreger", items: tools.slice(10) }].map(group => <div className="board-tool-group" key={group.label}><div className="layout-tool-buttons" role="group" aria-label={group.label}>{group.items.map(item => <button key={item.id} type="button" aria-label={item.label} data-tooltip={item.label} aria-pressed={tool === item.id} onClick={() => setTool(item.id)}>{item.id === "emoji" ? <span className="board-tool-emoji" aria-hidden="true">😀</span> : <ToolIcon id={item.id} />}</button>)}</div></div>)}
        <div className="direction-control" role="group" aria-label="Ordretning"><button type="button" data-tooltip="Vandret" aria-label="Vandret" aria-pressed={direction === "across"} onClick={() => chooseDirection("across")}>→</button><button type="button" data-tooltip="Lodret" aria-label="Lodret" aria-pressed={direction === "down"} onClick={() => chooseDirection("down")}>↓</button></div>
      </div>
      <div className="board-toolbar-footer"><span className="tool-name">{tools.find(item => item.id === tool)?.label}</span><div className="board-action-buttons" role="group" aria-label="Gitterfunktioner"><button type="button" data-tooltip="Kontrollér udfyldning" onClick={() => startAutofill(undefined, true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg><span>Kontrollér</span></button><button type="button" data-tooltip="Fyld gitteret" onClick={() => startAutofill()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 12l3 3 5-6" /></svg><span>Fyld gitter</span></button><button type="button" data-tooltip="Ryd alle bogstaver" onClick={() => updateLetters({})}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg><span>Ryd bogstaver</span></button></div></div>
    {editingClueId && <div className="clue-edit-tool" role="group" aria-label="Rediger ledetråd"><label>Ledetråd<input autoFocus aria-label="Tekstledetråd til valgt ord" value={clues[editingClueId] ?? ""} onChange={event => setClues(current => ({ ...current, [editingClueId]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape") setEditingClueId(null); }} placeholder="Brug ordbogens ledetråd" /></label><button type="button" onClick={() => setEditingClueId(null)}>Færdig</button></div>}
    </div>
    {tool === "image-area" && <div className="image-choices"><label>Fyld billedområdet med<select aria-label="Vælg illustration" value={(selectedImage?.illustration ?? illustration).startsWith("data:") ? "upload" : (selectedImage?.illustration ?? illustration)} onChange={event => { if (event.target.value !== "upload") { setIllustration(event.target.value); updateSelectedImage({ illustration: event.target.value }); } }}><option value="preset:landscape">Landskab</option><option value="preset:flower">Blomst</option><option value="preset:house">Hus</option><option value="upload">Upload eget billede</option></select></label><input aria-label="Upload billede" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === "string") { setIllustration(reader.result); updateSelectedImage({ illustration: reader.result }); } }; reader.readAsDataURL(file); }} /></div>}
    {tool === "emoji" && <div className="emoji-choices"><small>Klik på et felt for at placere en åben emoji-ledetråd. Vælg et svar med den rigtige længde under Ordforslag for at bestemme emojien.</small></div>}
    {tool === "image-area" && selectedImage && <div className="image-controls" role="group" aria-label="Indstillinger for valgt billede">
      <strong>Valgt billedområde · række {selectedImage.row + 1}, kolonne {selectedImage.col + 1}</strong>
      <div className="image-size-controls"><span>Bredde: {selectedImage.width}</span><button type="button" aria-label="Formindsk billedområdets bredde" disabled={selectedImage.width <= 1} onClick={() => resizeSelectedImage(selectedImage.width - 1, selectedImage.height)}>−</button><button type="button" aria-label="Forøg billedområdets bredde" disabled={selectedImage.col + selectedImage.width >= layout.width} onClick={() => resizeSelectedImage(selectedImage.width + 1, selectedImage.height)}>+</button><span>Højde: {selectedImage.height}</span><button type="button" aria-label="Formindsk billedområdets højde" disabled={selectedImage.height <= 1} onClick={() => resizeSelectedImage(selectedImage.width, selectedImage.height - 1)}>−</button><button type="button" aria-label="Forøg billedområdets højde" disabled={selectedImage.row + selectedImage.height >= layout.height} onClick={() => resizeSelectedImage(selectedImage.width, selectedImage.height + 1)}>+</button></div>
      <label>Tilpasning<select aria-label="Billedtilpasning" value={selectedImage.fit ?? "cover"} onChange={event => updateSelectedImage({ fit: event.target.value as "cover" | "contain" })}><option value="cover">Fyld boksen (beskær)</option><option value="contain">Tilpas hele billedet til boksen</option></select></label>
      <button type="button" onClick={() => updateSelectedImage({ offsetX: 50, offsetY: 50 })}>Centrér billedet</button>
      <p>Størrelsen ændres fra øverste venstre hjørne. Frigivne felter bliver sorte; udvidelse erstatter indholdet i de nye felter.</p>
    </div>}
    <details className="board-help"><summary>Hjælp til værktøjet</summary><p className="helper">{tool === "write" ? "Vælg ordretning, og klik på et bogstavfelt for at vælge et ord. Træk i et billede for at flytte det." : tool === "autofill" ? "Vælg ordretning, og klik på et bogstavfelt for at autofylde ordet." : tool === "edit-clue" ? "Klik på en ledetråd i feltet for at redigere den." : tool === "image-area" ? "Træk over felterne for at oprette et billedområde, eller klik på et eksisterende område for at ændre det." : tool === "emoji" ? "Vælg en emoji og klik på et felt. Ordforslag og autofyldning bruger kun svar, der passer til emojien." : "Vælg et værktøj og klik på feltet. Store ledetrådsfelter starter i det valgte felt. Vælg bogstavfelt for at fjerne eller flytte en ledetråd."}</p></details>
    <p className="layout-status" role="status">{layoutMessage} {!initialGeneration && layoutErrors.length > 0 && `Feltet er ikke klar: ${layoutErrors.length} strukturelle problemer. Alle ord skal have mindst ét bogstav og en ledetråd.`}</p>
    {!initialGeneration && autofillProgress && <div className="autofill-progress"><p role="status">{autofillWorker.current ? "Søgning: " : "Seneste søgning: "}{autofillProgress}</p>{autofillWorker.current && <button type="button" className="subtle" onClick={cancelAutofill}>Afbryd søgning</button>}</div>}
    {!initialGeneration && layoutErrors.length > 0 && <details className="layout-errors"><summary>Se problemer i feltet</summary><ul>{[...new Set(layoutErrors.map(error => describeLayoutError(error, layout)))].map(error => <li key={error}>{error}</li>)}</ul></details>}
    {initialGeneration ? <div className="board-loading" role="status"><strong>Genererer et felt med en bekræftet løsning …</strong><span>{autofillProgress}</span></div> : <div className="board-wrap"><div className={`editor-board${tool === "image-area" ? " image-area-tool" : ""}`} role="group" aria-label="Krydsordsfelt" onPointerUp={finishImageArea} style={{ gridTemplateColumns: `repeat(${layout.width}, 48px)`, gridTemplateRows: `repeat(${layout.height}, 48px)` }}>
    {Array.from({ length: layout.height }, (_, row) => Array.from({ length: layout.width }, (_, col) => {
      const key = keyOf(row, col);
      const clue = layout.clues.find(area => row >= area.row && row < area.row + area.height && col >= area.col && col < area.col + area.width);
      const imageArea = layout.images.find(area => row >= area.row && row < area.row + area.height && col >= area.col && col < area.col + area.width);
      const image = !!imageArea;
      const block = layout.blocks?.some(item => item.row === row && item.col === col);
      const arrow = layout.arrows?.find(item => item.row === row && item.col === col);
      const style = { gridRow: row + 1, gridColumn: col + 1 };
      const problems = problemCells.get(key);
      const problemClass = problems ? " layout-problem" : "";
      const problemTitle = problems ? [...problems].join(" ") : undefined;
      const selectedForImage = tool === "image-area" && imageDrag && row >= Math.min(imageDrag.start.row, imageDrag.end.row) && row <= Math.max(imageDrag.start.row, imageDrag.end.row) && col >= Math.min(imageDrag.start.col, imageDrag.end.col) && col <= Math.max(imageDrag.start.col, imageDrag.end.col);
      if (tool === "image-area" && imageArea) {
        if (imageArea.row !== row || imageArea.col !== col) return null;
        const src = imageArea.illustration?.startsWith("data:") ? imageArea.illustration : imageArea.illustration?.startsWith("preset:") ? `/illustrations/${imageArea.illustration.slice(7)}.svg` : undefined;
        return <button key={key} type="button" className={`edit-image-area${imageArea.id === selectedImageId ? " selected" : ""}`} style={{ gridRow: `${row + 1} / span ${imageArea.height}`, gridColumn: `${col + 1} / span ${imageArea.width}` }} aria-label={`Rediger række ${row + 1}, kolonne ${col + 1}`} aria-pressed={imageArea.id === selectedImageId} onClick={() => setSelectedImageId(imageArea.id)}>{src ? <img src={src} alt="" draggable={false} style={{ objectFit: imageArea.fit ?? "cover", objectPosition: `${imageArea.offsetX ?? 50}% ${imageArea.offsetY ?? 50}%` }} /> : "✦"}</button>;
      }
      if (tool !== "write" && tool !== "autofill" && tool !== "edit-clue") {
        const clueWords = clue ? layout.words.filter(word => word.clueId === clue.id) : [];
        const anchored = clue ? clueWords.filter(word => word.direction === "across"
          ? col === clue.col + clue.width - 1 && row === Math.max(clue.row, Math.min(clue.row + clue.height - 1, word.start.row))
          : row === clue.row + clue.height - 1 && col === Math.max(clue.col, Math.min(clue.col + clue.width - 1, word.start.col))) : [];
        const ordered = clue ? cluePresentation({ ...clue, row, col, width: 1, height: 1 }, anchored.map(word => ({ ...word, row: word.start.row, col: word.start.col }))).words : [];
        const chosenEmojiEntry = clue?.emojiAny ? layout.words.filter(word => word.clueId === clue.id && (!clue.emojiDirection || clue.emojiDirection === word.direction)).map(word => {
          const spelling = wordCells(word).map(cell => letters[keyOf(cell.row, cell.col)] ?? "").join("");
          return spelling.length === word.length ? allEntries.find(entry => entry.source === "emoji" && answerLetters(entry.word) === spelling && fitsBreaks(word, entry.word) && entry.clue === clues[word.id]) ?? allEntries.find(entry => entry.source === "emoji" && answerLetters(entry.word) === spelling && fitsBreaks(word, entry.word)) : undefined;
        }).find(Boolean) : undefined;
        const largeClue = clue && (clue.width > 1 || clue.height > 1);
        const clueProblems = largeClue && Array.from({ length: clue.width * clue.height }, (_, i) => problemCells.get(keyOf(clue.row + Math.floor(i / clue.width), clue.col + i % clue.width))).some(Boolean);
        return <Fragment key={key}>{largeClue && clue.row === row && clue.col === col && <div aria-hidden="true" className={`edit-clue-area${clueProblems ? " layout-problem" : ""}`} style={{ gridRow: `${row + 1} / span ${clue.height}`, gridColumn: `${col + 1} / span ${clue.width}` }} />}<button style={style} className={`edit-tile ${clue ? "edit-clue" : image || block ? "edit-block" : arrow ? "edit-arrow" : ""}${clue?.emoji || clue?.emojiAny ? " edit-emoji-cell" : ""}${selectedForImage || (tool === "image-area" && imageArea?.id === selectedImageId) ? " image-selection" : ""}${largeClue ? " edit-clue-cell" : problemClass}`} data-tooltip={problemTitle} aria-invalid={!!problems} aria-label={clue?.emoji || clue?.emojiAny ? `Emoji-ledetråd ${clue.emoji ?? ""}, række ${row + 1}, kolonne ${col + 1}` : `Rediger række ${row + 1}, kolonne ${col + 1}`} onPointerDown={() => startImageArea(row, col)} onPointerEnter={() => extendImageArea(row, col)} onClick={() => changeCell(row, col)}>{clue?.emoji || clue?.emojiAny ? <span aria-hidden="true">{clue.emoji || chosenEmojiEntry?.clue || "?"}</span> : clue ? ordered.map(word => <span key={word.id} aria-hidden="true" className={`edit-clue-arrow ${word.direction === "across" ? "clue-arrow-across" : "clue-arrow-down"}${ordered.length > 1 ? " shared" : ""}`}>{word.direction === "across" ? "→" : "↓"}</span>) : arrow ? (arrow.direction === "across" ? "→" : "↓") : letters[key] ?? ""}</button></Fragment>;
      }
      if (clue) {
        if (clue.row !== row || clue.col !== col) return null;
        const clueWords = layout.words.filter(word => word.clueId === clue.id).map(word => ({ ...word, row: word.start.row, col: word.start.col }));
        const display = cluePresentation(clue, clueWords);
        const clueProblems = Array.from({ length: clue.width * clue.height }, (_, i) => problemCells.get(keyOf(row + Math.floor(i / clue.width), col + i % clue.width))).filter(Boolean);
        return <div key={key} className={`editor-clue ${display.horizontal ? "clue-horizontal" : ""}${clue.emoji || clue.emojiAny ? " emoji-cue" : ""} ${clueProblems.length ? "layout-problem" : ""}`} data-tooltip={clueProblems.flatMap(item => [...item!]).join(" ") || undefined} style={{ gridRow: `${row + 1} / span ${clue.height}`, gridColumn: `${col + 1} / span ${clue.width}` }}>{display.words.map(word => {
          const straight = word.direction === "across" ? word.start.row >= clue.row && word.start.row < clue.row + clue.height && word.start.col === clue.col + clue.width : word.start.col >= clue.col && word.start.col < clue.col + clue.width && word.start.row === clue.row + clue.height;
          const position = word.direction === "down" && clue.width > 1 && (!display.horizontal || display.words.length === 1) && word.col >= clue.col && word.col < clue.col + clue.width
            ? { left: `${(word.col - clue.col + 0.5) * 100 / clue.width}%`, transform: "translateX(-50%)" }
            : word.direction === "across" && clue.height > 1 && (display.horizontal || display.words.length === 1) && word.row >= clue.row && word.row < clue.row + clue.height
              ? { top: `${(word.row - clue.row + 0.5) * 100 / clue.height}%`, transform: "translateY(-50%)" }
              : undefined;
          const spelling = wordCells(word).map(cell => letters[keyOf(cell.row, cell.col)] ?? "").join("");
          const appliesEmoji = Boolean((clue.emoji || clue.emojiAny) && (!clue.emojiDirection || clue.emojiDirection === word.direction));
          const emojiEntry = appliesEmoji && clue.emojiAny && spelling.length === word.length ? allEntries.find(entry => entry.source === "emoji" && answerLetters(entry.word) === spelling && fitsBreaks(word, entry.word) && entry.clue === clues[word.id]) ?? allEntries.find(entry => entry.source === "emoji" && answerLetters(entry.word) === spelling && fitsBreaks(word, entry.word)) : undefined;
          const chosenClue = appliesEmoji ? clue.emoji || emojiEntry?.clue || "?" : clues[word.id]?.trim();
          const suggestionCount = backgroundStatus.perWord[word.id];
          const countLabel = suggestionCount === undefined ? "" : `${suggestionCount} forskellige svar i gemte løsninger`;
          if (inlineClueId === word.id && !clue.emoji && !clue.emojiAny) return <textarea key={word.id} className="inline-clue-editor" autoFocus aria-label={`Rediger ledetråd ${word.direction === "across" ? "vandret" : "lodret"}`} value={clues[word.id] ?? ""} onChange={event => setClues(current => ({ ...current, [word.id]: event.target.value }))} onBlur={() => setInlineClueId(null)} onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); setInlineClueId(null); } }} />;
          return <button key={word.id} className={selectedId === word.id ? "editor-clue-selected" : ""} onClick={() => { setSelectedId(word.id); setDirection(word.direction); setSelectedCell(null); if (tool === "edit-clue" && !clue.emoji && !clue.emojiAny) setEditingClueId(word.id); }} onDoubleClick={() => { if (clue.emoji || clue.emojiAny) return; setEditingClueId(null); setInlineClueId(word.id); }} aria-invalid={clueProblems.length > 0} data-tooltip={[chosenClue, clueProblems.flatMap(item => [...item!]).join(" "), countLabel].filter(Boolean).join(" · ") || undefined} aria-label={`Vælg ${word.direction === "across" ? "vandret" : "lodret"} ord, række ${word.start.row + 1}, kolonne ${word.start.col + 1}${chosenClue ? `, ledetråd: ${chosenClue}` : ""}${countLabel ? `, ${countLabel}` : ""}`}><span className="editor-clue-text" style={position}>{chosenClue || ""}</span>{showGridCounts && suggestionCount !== undefined && <span className={`clue-suggestion-count ${word.direction}`} aria-hidden="true">{suggestionCount}</span>}<span aria-hidden="true" className={word.direction === "down" ? "clue-arrow-down" : "clue-arrow-across"} style={position}>{straight ? (word.direction === "across" ? "→" : "↓") : (word.direction === "across" ? "↓→" : "→↓")}</span></button>;
        })}</div>;
      }
      if (arrow) return <div key={key} className={`edit-arrow editor-separator${problemClass}`} data-tooltip={problemTitle} style={style} aria-label={arrow.direction === "across" ? "Bindestreg, pil til højre" : "Bindestreg, pil ned"}>{arrow.direction === "across" ? "→" : "↓"}</div>;
      if (imageArea) {
        if (imageArea.row !== row || imageArea.col !== col) return null;
        const src = imageArea.illustration?.startsWith("data:") ? imageArea.illustration : imageArea.illustration?.startsWith("preset:") ? `/illustrations/${imageArea.illustration.slice(7)}.svg` : undefined;
        return <div key={key} className={`editor-image${tool === "write" && src ? " editor-image-draggable" : ""}${problemClass}`} style={{ ...style, gridRow: `${row + 1} / span ${imageArea.height}`, gridColumn: `${col + 1} / span ${imageArea.width}` }} onPointerDown={event => { if (tool !== "write" || !src) return; event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); const img = event.currentTarget.querySelector("img"); if (!img || !img.naturalWidth || !img.naturalHeight) return; const scale = (imageArea.fit ?? "cover") === "contain" ? Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight) : Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight); imagePanRef.current = { row, col, x: event.clientX, y: event.clientY, offsetX: imageArea.offsetX ?? 50, offsetY: imageArea.offsetY ?? 50, availableX: rect.width - img.naturalWidth * scale, availableY: rect.height - img.naturalHeight * scale }; }} onPointerMove={event => { const pan = imagePanRef.current; if (!pan || pan.row !== row || pan.col !== col) return; const offsetX = Math.max(0, Math.min(100, pan.offsetX + (Math.abs(pan.availableX) > 0.5 ? (event.clientX - pan.x) / pan.availableX * 100 : 0))); const offsetY = Math.max(0, Math.min(100, pan.offsetY + (Math.abs(pan.availableY) > 0.5 ? (event.clientY - pan.y) / pan.availableY * 100 : 0))); setLayout(current => ({ ...current, images: current.images.map(area => area.row === row && area.col === col ? { ...area, offsetX, offsetY } : area) })); setPublishMessage(""); }} onPointerUp={() => { imagePanRef.current = null; }} onPointerCancel={() => { imagePanRef.current = null; }}>{src ? <img src={src} alt="" draggable={false} style={{ objectFit: imageArea.fit ?? "cover", objectPosition: `${imageArea.offsetX ?? 50}% ${imageArea.offsetY ?? 50}%` }} /> : "✦"}{imageCueTargets(imageArea, layout).map(({ word, marker }) => { const active = word.clueId === imageArea.id; const direction = word.direction === "across" ? "vandret" : "lodret"; return <button key={word.id} type="button" className={`image-cue-target${active ? " active" : ""}`} style={{ left: `${marker.left}%`, top: `${marker.top}%` }} aria-pressed={active} aria-label={`${active ? "Fjern billedet som cue" : "Brug billedet som cue"} for ${direction} svar i række ${word.start.row + 1}, kolonne ${word.start.col + 1}${active && backgroundStatus.perWord[word.id] !== undefined ? `, ${backgroundStatus.perWord[word.id]} forskellige svar i gemte løsninger` : ""}`} data-tooltip={`${active ? "Fjern billedet som cue" : "Brug billedet som cue"} for ${direction} svar${active && backgroundStatus.perWord[word.id] !== undefined ? ` · ${backgroundStatus.perWord[word.id]} forskellige svar i gemte løsninger` : ""}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); changeWordCue(word, active ? (word.textClueId ?? `missing-${word.direction}-${word.start.row}-${word.start.col}`) : imageArea.id); }}>{active ? marker.arrow : "+"}{showGridCounts && active && backgroundStatus.perWord[word.id] !== undefined && <span className="image-suggestion-count" aria-hidden="true">{backgroundStatus.perWord[word.id]}</span>}</button>; })}</div>;
      }
      if (block) return <div key={key} className={`${block ? "editor-dark" : "editor-block"}${problemClass}`} data-tooltip={problemTitle} style={style} />;
      return <input key={key} style={style} className={`editor-cell ${selectedKeys.has(key) ? "selected" : ""}${problemClass}`} data-tooltip={problemTitle} aria-invalid={!!problems} aria-label={`Række ${row + 1}, kolonne ${col + 1}`} value={letters[key] ?? ""} maxLength={1} onClick={() => chooseCell(row, col)} onChange={event => { const value = event.target.value.toLocaleUpperCase("da-DK").slice(-1); if (value && !/^[A-ZÆØÅ]$/.test(value)) return; const next = { ...letters }; if (value) next[key] = value; else delete next[key]; updateLetters(next); }} />;
    }))}</div></div>}<p className="helper">Bogstaver kan skrives direkte i feltet. Forslag indsættes ved at klikke på dem.</p>
    {backgroundStatus.state !== "idle" && <section className="background-finder" aria-label="Baggrundsstatistik"><div className="background-finder-heading"><strong>Baggrundsstatistik</strong><span className={`background-finder-state ${backgroundStatus.state}`}><i aria-hidden="true" />{backgroundStatus.state === "searching" ? "Søger" : backgroundStatus.state === "error" ? "Fejl i søgningen" : "Alle kandidater undersøgt"}</span></div><div className="background-finder-metrics"><div><strong>{backgroundStatus.count.toLocaleString("da-DK")} <small>/ 256</small></strong><span>Gemte løsninger</span></div><div><strong>{backgroundStatus.average.toLocaleString("da-DK", { maximumFractionDigits: 1 })}</strong><span>Forslag pr. ord i snit</span></div><div><strong>{backgroundStatus.minimum === null ? "—" : backgroundStatus.minimum.toLocaleString("da-DK")}</strong><span>Færrest forslag til et ord</span></div></div><p>Baseret på de gemte løsninger. Færrest forslag gælder kun ord med tomme felter.</p><label className="grid-count-toggle"><input type="checkbox" checked={showGridCounts} onChange={event => setShowGridCounts(event.target.checked)} /> Vis antal i feltet</label></section>}</section>
    <PanelResizer containerRef={workspaceRef} value={panelWidth} min={35} max={75} onChange={setPanelWidth} label="Juster bredden på panelerne" valueLabel="til krydsordet" />
    <aside className="suggestion-panel">
      <PanelHeading number="02" label="ORDFORSLAG" title="Ord og ledetråd" />
      <div className="forced-words"><div className="help-title"><strong>Fastlagte ord</strong><span className="info-tip"><button type="button" aria-label="Om fastlagte ord" aria-describedby="forced-words-help">i</button><span id="forced-words-help" role="tooltip">Disse ord skal indgå i løsningen. De indsættes automatisk, når kun én placering er mulig.</span></span></div>{forcedWords.length ? forcedWords.map(entry => <button type="button" key={entry.word} onClick={() => setForcedWords(current => current.filter(item => item.word !== entry.word))} aria-label={`Fjern ${entry.word} fra fastlagte ord`}>{entry.word} ×</button>) : <small>Ingen fastlagte ord endnu.</small>}{forcedStatus && <p role="status">{forcedStatus}</p>}</div>
      {dictionaries.length > 0 && <div className="dictionary-picker"><label>Vælg ordbog <select aria-label="Vælg ordbog" value={currentDictionary?.id ?? ""} onChange={event => { setDictionaryId(event.target.value); setEditingKey(null); setMessage(""); }}>{dictionaries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{currentDictionary && <label><input type="checkbox" aria-label={`Brug ${currentDictionary.name} i forslag og autofyldning`} checked={currentDictionary.enabled} onChange={event => updateDictionary({ ...currentDictionary, enabled: event.target.checked })} /> Brug i forslag og autofyldning</label>}</div>}
      {selected ? <><div className="selection-info" data-direction={selected.direction === "across" ? "→" : "↓"}><span>{selected.direction === "across" ? "→ VANDRET" : "↓ LODRET"} · {selected.length} BOGSTAVER</span><strong>{pattern}</strong><small>Række {selected.start.row + 1}, kolonne {selected.start.col + 1}</small></div>
      <div className="suggestion-status-row"><div className="suggestion-status" role="status">{searchErrors.length || !searchLayout.words.some(word => word.id === selectedId) ? "Tilføj en ledetråd til ordet for at se forslag." : progress.done ? (progress.checked < progress.total ? `Viser de første ${suggestions.length} mulige ord.` : `${suggestions.length} mulige ord fundet.`) : `Undersøger ord … ${progress.checked}${progress.total ? ` / ${progress.total}` : ""}`} {progress.uncertain > 0 && `${progress.uncertain} kunne ikke afgøres inden for beregningsgrænsen.`}</div><div className="suggestion-help"><span className="info-tip"><button type="button" aria-label="Om ordforslagene" aria-describedby="suggestions-help">i</button><span id="suggestions-help" role="tooltip">Hvert vist ord er afprøvet mod alle ord med ledetråd og de nuværende bogstaver. Samme ord bruges højst én gang.</span></span></div></div>
      <label className="suggestion-sort">Sortér efter<select aria-label="Sortér ordforslag" value={suggestionSort} onChange={event => setSuggestionSort(event.target.value as "score" | "alphabetical")}><option value="score">Højeste kildescore</option><option value="alphabetical">Alfabetisk</option></select></label>
      <label className="unique-words-toggle"><input type="checkbox" checked={showEachWordOnce} onChange={event => setShowEachWordOnce(event.target.checked)} />Vis hvert ord én gang</label>
      <div className={`suggestion-list${showEachWordOnce ? " unique-words" : ""}`}>{showEachWordOnce ? sortedSuggestions.map(({ entry, clues }) => <div className="suggestion-word" key={entry.word}><strong>{entry.word}</strong><button type="button" className="force-word" aria-label={`${forcedWords.some(item => item.word === entry.word) ? "Fjern fastgørelse af" : "Fastgør"} ${entry.word}`} title={forcedWords.some(item => item.word === entry.word) ? "Fjern fastgørelse" : "Fastgør ord"} aria-pressed={forcedWords.some(item => item.word === entry.word)} onClick={() => setForcedWords(current => current.some(item => item.word === entry.word) ? current.filter(item => item.word !== entry.word) : [...current, entry])}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 13v8" /></svg></button><small>{wordScores.get(entry.word) ?? 0} point</small><div className="suggestion-clues">{clues.map(({ clue, score }) => <button key={clue} onClick={() => applyWord(entry.word, clue)}>{clue}<small>{score} point</small><b>+</b></button>)}</div></div>) : sortedSuggestionClues.map(({ entry, clue, score }) => <div className="forced-suggestion" key={`${entry.word}:${clue}`}><button onClick={() => applyWord(entry.word, clue)}><strong>{entry.word}</strong><span>{clue}</span><small>{score} point</small><b>+</b></button><button type="button" className="force-word" aria-label={`${forcedWords.some(item => item.word === entry.word) ? "Fjern fastgørelse af" : "Fastgør"} ${entry.word}`} title={forcedWords.some(item => item.word === entry.word) ? "Fjern fastgørelse" : "Fastgør ord"} aria-pressed={forcedWords.some(item => item.word === entry.word)} onClick={() => setForcedWords(current => current.some(item => item.word === entry.word) ? current.filter(item => item.word !== entry.word) : [...current, entry])}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 13v8" /></svg></button></div>)}</div>
      {progress.done && suggestions.length === 0 && <p className="empty">Ingen bekræftede muligheder. Prøv at ændre eller fjerne bogstaver.</p>}
      <button className="subtle clear-word" onClick={() => { const next = { ...letters }; wordCells(selected).forEach(cell => delete next[keyOf(cell.row, cell.col)]); updateLetters(next); }}>Ryd det valgte ord</button></> : <p>Vælg et ord i feltet.</p>}
    </aside></div>}
    {designerTab === "dictionaries" && <section className="dictionary-manager" aria-label="Ordbøger">
      <div className="dictionary-layout" ref={dictionaryWorkspaceRef} style={{ "--archive-share": `${dictionaryPanelWidth}fr`, "--dictionary-share": `${100 - dictionaryPanelWidth}fr` } as CSSProperties}>
      <section className="dictionary-archive dictionary-panel" aria-labelledby="dictionary-archive-title">
      <PanelHeading number="01" label="ARKIV" title="Dine ordbøger" id="dictionary-archive-title" /><p className="dictionary-panel-description">Vælg ordbøger til forslag og autofyldning.</p><div className="dictionary-create"><label htmlFor="new-dictionary-name">Ny ordbog</label><div><input id="new-dictionary-name" value={newName} onChange={event => setNewName(event.target.value)} placeholder="Fx Steder eller Fagord" /><button type="button" onClick={() => { const name = newName.trim(); if (!name) { setMessage("Skriv et navn til ordbogen."); return; } const item: CustomDictionary = { id: crypto.randomUUID(), name, enabled: true, entries: [] }; onDictionariesChange([...dictionaries, item]); setDictionaryId(item.id); setBrowseDictionary(null); setNewName(""); setText(""); setMessage(""); }}>Opret ordbog</button></div></div>
      <div className="dictionary-file-import"><label>Importér ordbog (JSON)<input type="file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importDictionary(file); }} /></label><p>Import opretter en ny ordbog, som er slået fra.</p><p role="status">{message}</p></div>
      <div className="builtin-dictionary-settings"><BuiltinDictionaryOptions settings={builtinDictionarySettings} onChange={onBuiltinDictionarySettingsChange} onBrowse={source => { const option = BUILTIN_DICTIONARY_COLLECTIONS.find(item => item.source === source)!; setBrowseDictionary({ id: source, name: option.label, entries: dictionary.filter(entry => entry.source === source) }); }}>
        {[false, true].map(shared => <Fragment key={String(shared)}>
          <h4 className="dictionary-group-title">{shared ? "Delte ordbøger" : "Egne ordbøger"}</h4>
          {dictionaries.filter(item => Boolean(item.shared) === shared).map(item => {
            const published = !shared && sharedDictionaries.some(row => row.id === (item.shareId ?? item.id) && row.owner_id === userId);
            return <article className={`builtin-dictionary-card personal-dictionary-card${currentDictionary?.id === item.id ? " selected-dictionary-card" : ""}`} key={item.id}>
              <div className="personal-dictionary-heading"><strong>{item.name}</strong><small>{countDictionaryWords(item.entries).toLocaleString("da-DK")} ord · {shared ? "Tilføjet til dit arkiv" : published ? "Delt offentligt" : "Privat"}</small></div>
              <div className="personal-dictionary-enable"><label><input type="checkbox" aria-label={`Brug ${item.name} i forslag og autofyldning`} checked={item.enabled} onChange={event => onDictionariesChange(dictionaries.map(dictionary => dictionary.id === item.id ? { ...dictionary, enabled: event.target.checked } : dictionary))} /> Forslag og autofyldning</label></div>
              <div className="personal-dictionary-actions"><button type="button" onClick={() => setBrowseDictionary({ id: `custom:${item.id}`, name: item.name, entries: item.entries })} aria-label={`Se ord i ${item.name}`}>Se ord</button><a href="#custom-dictionary-editor" aria-current={currentDictionary?.id === item.id && !browseDictionary ? "true" : undefined} onClick={() => { setBrowseDictionary(null); setDictionaryId(item.id); setEntrySearch(""); setEntryPage(0); setEditingKey(null); setText(""); setMessage(""); }}>{currentDictionary?.id === item.id ? "Valgt" : shared ? "Åbn" : "Rediger"}</a>{shared ? <button type="button" onClick={() => { onDictionariesChange(dictionaries.filter(dictionary => dictionary.id !== item.id)); if (dictionaryId === item.id) setDictionaryId(dictionaries.find(dictionary => !dictionary.shared && dictionary.id !== item.id)?.id ?? ""); }}>Fjern fra mit arkiv</button> : <button type="button" onClick={() => void onSharedDictionaryChange(item, !published)}>{published ? "Stop deling" : "Del ordbog"}</button>}</div>
            </article>;
          })}
          {shared && sharedDictionaries.filter(row => row.owner_id !== userId && !dictionaries.some(item => item.sharedId === row.id)).map(row => {
            const sharedEntries = parseCustomDictionaries([{ id: row.id, name: row.name, entries: row.entries }])[0]?.entries ?? [];
            return <article className="builtin-dictionary-card personal-dictionary-card" key={row.id}>
              <div className="personal-dictionary-heading"><strong>{row.name}</strong><small>{countDictionaryWords(sharedEntries).toLocaleString("da-DK")} ord · Delt af en anden bruger</small></div>
              <p className="shared-card-description">Tilføj ordbogen for at bruge den til forslag og autofyldning.</p>
              <div className="personal-dictionary-actions"><button type="button" onClick={() => setBrowseDictionary({ id: `shared:${row.id}`, name: row.name, entries: sharedEntries })} aria-label={`Se ord i ${row.name}`}>Se ord</button><button type="button" onClick={() => { const imported = parseCustomDictionaries([{ id: `shared:${row.id}`, sharedId: row.id, shared: true, ownerLabel: "Anden bruger", name: row.name, entries: row.entries, enabled: false }])[0]; if (imported) { onDictionariesChange([...dictionaries, imported]); setDictionaryId(imported.id); setBrowseDictionary(null); setMessage(""); } }}>Tilføj ordbog</button></div>
            </article>;
          })}
          {!shared && !dictionaries.some(item => !item.shared) && <p className="dictionary-group-empty">Opret en ordbog for at samle dine egne ord.</p>}
          {shared && !dictionaries.some(item => item.shared) && !sharedDictionaries.some(row => row.owner_id !== userId) && <p className="dictionary-group-empty">Ingen delte ordbøger endnu.</p>}
        </Fragment>)}
      </BuiltinDictionaryOptions></div>
      </section>
      <PanelResizer containerRef={dictionaryWorkspaceRef} value={dictionaryPanelWidth} min={28} max={52} onChange={setDictionaryPanelWidth} label="Juster bredden på ordbogspanelerne" valueLabel="til ordbogsarkivet" />
      <div className="dictionary-panel dictionary-manager-body unified-dictionary-editor" id="custom-dictionary-editor">
      {browseDictionary ? <DictionaryBrowser key={browseDictionary.id} name={dictionaries.find(item => `custom:${item.id}` === browseDictionary.id)?.name ?? browseDictionary.name} entries={dictionaries.find(item => `custom:${item.id}` === browseDictionary.id)?.entries ?? browseDictionary.entries} attribution={dictionaries.find(item => `custom:${item.id}` === browseDictionary.id)?.attribution} onClose={() => setBrowseDictionary(null)} /> : currentDictionary ? <div className={`dictionary-workspace${currentDictionary.shared ? " shared-readonly" : ""}`}><PanelHeading number="02" label="VALGT ORDBOG" title={currentDictionary.name} /><p className="dictionary-panel-description">{currentDictionary.entries.length.toLocaleString("da-DK")} gemte ord og ledetråde{currentDictionary.shared ? " · Delt ordbog · Kun læsning" : ""}</p>{currentDictionary.attribution && <p className="dictionary-panel-description">{currentDictionary.attribution}</p>}<div className="dictionary-workspace-top"><button type="button" onClick={() => exportDictionary(currentDictionary.name, currentDictionary.entries, currentDictionary.attribution)}>Eksportér JSON</button><label className="dictionary-name-edit">Navn<input aria-label="Ordbogens navn" key={currentDictionary.id} defaultValue={currentDictionary.name} onBlur={event => { const name = event.target.value.trim(); if (name) updateDictionary({ ...currentDictionary, name }); else event.target.value = currentDictionary.name; }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><button className="danger-button" type="button" onClick={() => { if (window.confirm(`Slet ordbogen "${currentDictionary.name}" og alle dens ord?`)) { const remaining = dictionaries.filter(item => item.id !== currentDictionary.id); onDictionariesChange(remaining); setDictionaryId(remaining[0]?.id ?? ""); setEditingKey(null); setText(""); setMessage(""); } }}>Slet ordbog</button></div>
      <details className="dictionary-entry-add">
        <summary>Tilføj ord og ledetråde<span aria-hidden="true">+</span></summary>
        <div className="dictionary-entry-form">
          <label className="dictionary-format">Format <select value={clueFirstDictionaryFormat ? "clue" : "word"} onChange={event => setClueFirstDictionaryFormat(event.target.value === "clue")}><option value="word">Ord først</option><option value="clue">Ledetråd først</option></select></label>
          <p className="dictionary-format-example">{clueFirstDictionaryFormat ? <>Eksempel: <code>Fodboldklub;AGF;FCK;Brøndby</code></> : <>Eksempel: <code>CYKEL;Køretøj;Transportmiddel</code></>}<br />Du kan også skrive <code>Ledetråd: ORD|ORD</code>.</p>
          <textarea aria-label="Ord og ledetråde" value={text} onChange={event => setText(event.target.value)} placeholder={clueFirstDictionaryFormat ? 'Fodboldklub;AGF;FCK;Brøndby' : 'CYKEL;Køretøj med to hjul\nPigenavn: Hanne|Sigrid'} rows={3} />
          <div className="dictionary-entry-actions-bottom"><label className="dictionary-both-directions"><input type="checkbox" checked={useBothDictionaryDirections} onChange={event => setUseBothDictionaryDirections(event.target.checked)} /><span>Brug også ledetråden som svar <small>Kun når den kan bruges som et gyldigt svar.</small></span></label><button type="button" onClick={addWords}>Tilføj ord</button></div>
        </div>
      </details>
      <label className="dictionary-browser-search">Søg efter ord eller ledetråd<input type="search" value={entrySearch} onChange={event => { setEntrySearch(event.target.value); setEntryPage(0); }} placeholder="Skriv for at søge" /></label><div className="dictionary-entries-heading"><div><h4>Ord i denne ordbog</h4><p>Vælg en kolonne for at sortere efter ledetråd eller ord.</p></div><span>{currentDictionary.entries.length}</span></div><div className="dictionary-entry-list" role="table" aria-label={`Ord i ${currentDictionary.name}`}><div className="dictionary-entry-header" role="row"><button type="button" role="columnheader" aria-sort={entrySortBy === "clue" ? (entrySortDirection === "asc" ? "ascending" : "descending") : "none"} onClick={() => { if (entrySortBy === "clue") setEntrySortDirection(value => value === "asc" ? "desc" : "asc"); else { setEntrySortBy("clue"); setEntrySortDirection("asc"); } }}>Ledetråd {entrySortBy === "clue" ? (entrySortDirection === "asc" ? "↑" : "↓") : "↕"}</button><button type="button" role="columnheader" aria-sort={entrySortBy === "word" ? (entrySortDirection === "asc" ? "ascending" : "descending") : "none"} onClick={() => { if (entrySortBy === "word") setEntrySortDirection(value => value === "asc" ? "desc" : "asc"); else { setEntrySortBy("word"); setEntrySortDirection("asc"); } }}>Ord {entrySortBy === "word" ? (entrySortDirection === "asc" ? "↑" : "↓") : "↕"}</button><span aria-hidden="true" /></div>{sortedDictionaryEntries.slice(safeEntryPage * 40, safeEntryPage * 40 + 40).map(entry => { const key = customEntryKey(entry); return <div className="dictionary-entry" role="row" key={key}>{editingKey === key ? <><input aria-label="Rediger ord og ledetråd" value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") saveEdit(key); }} /><button type="button" onClick={() => saveEdit(key)}>Gem</button><button className="text-button" type="button" onClick={() => setEditingKey(null)}>Annuller</button></> : <><span className="dictionary-entry-clue" role="cell">{entry.clue}</span><strong className="dictionary-entry-word" role="cell">{entry.word}</strong>{dictionaries.length > 1 && <div className="dictionary-entry-actions"><select aria-label={`Målordbog for ${entry.word}: ${entry.clue}`} value={transferTargets[key] ?? ""} onChange={event => setTransferTargets(current => ({ ...current, [key]: event.target.value }))}><option value="">Vælg ordbog</option>{dictionaries.filter(item => item.id !== currentDictionary.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="text-button" type="button" disabled={!transferTargets[key]} onClick={() => transferEntry(entry, transferTargets[key], false)}>Kopiér</button><button className="text-button" type="button" disabled={!transferTargets[key]} onClick={() => transferEntry(entry, transferTargets[key], true)}>Flyt</button></div>}<button className="text-button" type="button" aria-label={`Rediger ${entry.word}: ${entry.clue}`} onClick={() => { setEditingKey(key); setEditText(`${entry.word};${entry.clue}`); }}>Rediger</button><button className="text-button remove" type="button" aria-label={`Fjern ${entry.word}: ${entry.clue}`} onClick={() => updateDictionary({ ...currentDictionary, entries: currentDictionary.entries.filter(item => customEntryKey(item) !== key) })}>Fjern</button></>}</div>; })}{currentDictionary.entries.length === 0 && <p className="dictionary-empty">Denne ordbog er tom endnu. Tilføj ord ovenfor.</p>}</div><div className="dictionary-browser-pages"><button type="button" disabled={safeEntryPage === 0} onClick={() => setEntryPage(safeEntryPage - 1)}>Forrige</button><span>{sortedDictionaryEntries.length ? `${safeEntryPage * 40 + 1}–${Math.min((safeEntryPage + 1) * 40, sortedDictionaryEntries.length)} af ${sortedDictionaryEntries.length.toLocaleString("da-DK")} poster` : "Ingen poster fundet"}</span><button type="button" disabled={(safeEntryPage + 1) * 40 >= sortedDictionaryEntries.length} onClick={() => setEntryPage(safeEntryPage + 1)}>Næste</button></div><p className="dictionary-message" role="status">{message}</p></div> : <div className="dictionary-no-selection"><PanelHeading number="02" label="VALGT ORDBOG" title="Din ordbog" /><h3>Ingen ordbøger endnu</h3><p>Opret en ordbog for at begynde at samle dine egne ord.</p></div>}</div>
      </div>
    </section>}
    </fieldset></main><footer className="editor-footer">Ord fra den indbyggede ordbog og <a href="https://wordnet.dk/dannet">DanNet</a> · CC BY-SA 4.0. Automatiske ledetråde er ikke individuelt gennemgået.</footer></div>;
}
