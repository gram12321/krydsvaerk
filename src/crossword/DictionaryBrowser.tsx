import { PanelHeading } from "../Presentation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { DictionaryEntry } from "./dictionary";
import { exportDictionary } from "./dictionaryFile";

const PAGE_SIZE = 40;

/** A bounded, read-only view of distinct answers and their clues. */
export function DictionaryBrowser({ name, entries, attribution, onClose }: { name: string; entries: readonly DictionaryEntry[]; attribution?: string; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("da-DK"));
  const words = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const { word, clue } of entries) {
      if (!grouped.has(word)) grouped.set(word, new Set());
      grouped.get(word)!.add(clue);
    }
    return [...grouped].map(([word, clues]) => ({ word, clues: [...clues].sort((a, b) => a.localeCompare(b, "da")) }))
      .sort((a, b) => a.word.localeCompare(b.word, "da"));
  }, [entries]);
  const matches = useMemo(() => deferredQuery ? words.filter(({ word, clues }) => word.toLocaleLowerCase("da-DK").includes(deferredQuery) || clues.some(clue => clue.toLocaleLowerCase("da-DK").includes(deferredQuery))) : words, [words, deferredQuery]);
  const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  return <section ref={panelRef} className="dictionary-browser" aria-label={`Ord i ${name}`}>
    <div className="dictionary-browser-heading"><PanelHeading number="02" label="UDFORSK ORDBOG" title={name} /><button type="button" onClick={() => exportDictionary(name, entries, attribution)}>Eksportér JSON</button><button type="button" onClick={onClose}>Luk</button></div>
    <p className="dictionary-panel-description">Søg blandt ord og ledetråde. Hvert ord vises én gang.</p>
    {attribution && <p className="dictionary-panel-description">{attribution}</p>}
    <label className="dictionary-browser-search">Søg efter ord eller ledetråd<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Skriv for at søge" /></label>
    <p className="dictionary-browser-result" role="status">{matches.length.toLocaleString("da-DK")} ord{deferredQuery ? " fundet" : " i ordbogen"}</p>
    {matches.length ? <ul className="dictionary-browser-list">{matches.slice(start, start + PAGE_SIZE).map(({ word, clues }) => <li key={word}><strong>{word}</strong><span>{clues.join(" · ")}</span></li>)}</ul> : <p className="dictionary-browser-empty">Ingen ord matcher din søgning.</p>}
    <div className="dictionary-browser-pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Forrige</button><span>{matches.length ? `${(start + 1).toLocaleString("da-DK")}–${Math.min(start + PAGE_SIZE, matches.length).toLocaleString("da-DK")} af ${matches.length.toLocaleString("da-DK")}` : "0 ord"}</span><button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Næste</button></div>
  </section>;
}
