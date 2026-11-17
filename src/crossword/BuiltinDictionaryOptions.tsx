import { BUILTIN_DICTIONARY_COLLECTIONS, BUILTIN_DICTIONARY_WORD_COUNTS, type BuiltinDictionarySource, type BuiltinDictionarySettings } from "./dictionary";
import type { ReactNode } from "react";

export function BuiltinDictionaryOptions({ settings, onChange, onBrowse, children }: {
  settings: BuiltinDictionarySettings;
  onChange: (next: BuiltinDictionarySettings) => void;
  onBrowse?: (source: BuiltinDictionarySource) => void;
  children?: ReactNode;
}) {
  return <fieldset className="builtin-dictionary-options">
    <legend>{children ? "Dine ordbøger" : "Indbyggede ordbøger"}</legend>
    <p>{children ? "Vælg ordbøger til forslag og autofyldning. Valgene bruges også ved oprettelse af nye krydsord." : "Valget gælder ordforslag, autofyldning og nye krydsord."}</p>
    <div>{children && <h4 className="dictionary-group-title">Indbyggede ordbøger</h4>}{BUILTIN_DICTIONARY_COLLECTIONS.map(({ source, label }) => <div className="builtin-dictionary-card" key={source}><label>
      <input type="checkbox" checked={settings[source]} onChange={event => onChange({ ...settings, [source]: event.target.checked })} />
      <span className="builtin-dictionary-copy"><strong>{label}</strong><small>{BUILTIN_DICTIONARY_WORD_COUNTS[source].toLocaleString("da-DK")} ord</small></span>
    </label>{onBrowse && <button type="button" onClick={() => onBrowse(source)} aria-label={`Se ord i ${label}`}>Se ord</button>}</div>)}{children}</div>
  </fieldset>;
}
