// The card list's search + sort machinery: the plain-text substring filter,
// backend (operator) queries with their debounced caches, the autocomplete
// vocabulary, and the persisted sort choice.

import { useEffect, useMemo, useState } from "react";
import type { Note } from "@/lib/types";
import {
  effectiveQuery,
  hasOperators,
  type SuggestionSources,
} from "@/lib/search-query";
import { findNoteIds } from "@/lib/notes";
import { stripCloze } from "@/lib/cloze";
import { stripHtml } from "@/lib/html-text";
import { foldText } from "@/lib/fold-text";

// A note's searchable text: its field values (HTML and cloze stripped) plus its
// tags, lowercased and diacritic-folded, for the plain-text substring filter.
//
// stripHtml costs a DOM parse per field, and search re-filters on every
// keystroke, so this is cached per note object (weakly — an edit or refetch
// replaces the note objects, dropping their stale entries with them). Without
// the cache a keystroke re-parsed every field of every note in the deck.
const haystackCache = new WeakMap<Note, string>();
function noteHaystack(note: Note): string {
  const cached = haystackCache.get(note);
  if (cached !== undefined) return cached;
  const text = Object.values(note.fields)
    .map((field) => field?.value)
    .filter(Boolean)
    .map((v) => stripCloze(stripHtml(v as string)))
    .concat(note.tags)
    .join(" ");
  const folded = foldText(text);
  haystackCache.set(note, folded);
  return folded;
}

/**
 * Notes within `scoped` matching `q`. An empty query keeps them all; operator
 * queries are resolved by Anki (the caller passes the cached note-id result for
 * `q`, and we fall back to the full scope until it lands); plain text uses the
 * in-memory substring filter.
 */
function notesForQuery(
  scoped: Note[],
  q: string,
  backend: { key: string; ids: Set<number> } | null,
): Note[] {
  if (q === "") return scoped;
  if (hasOperators(q)) {
    return backend?.key === q
      ? scoped.filter((note) => backend.ids.has(note.noteId))
      : scoped;
  }
  const needle = foldText(q);
  return scoped.filter((note) => noteHaystack(note).includes(needle));
}

// Autocomplete vocabulary present in a set of notes: their tags, note types, and
// home decks. Drawn from the *filtered* result set so the menu only ever offers
// values that still lead somewhere.
function collectSources(
  notes: Note[],
  homeDeck: (note: Note) => string,
): SuggestionSources {
  const tags = new Set<string>();
  const models = new Set<string>();
  const decks = new Set<string>();
  let hasUntagged = false;
  for (const note of notes) {
    if (note.tags.length === 0) hasUntagged = true;
    for (const t of note.tags) tags.add(t);
    models.add(note.modelName);
    decks.add(homeDeck(note));
  }
  const cmp = (a: string, b: string) => a.localeCompare(b);
  return {
    decks: [...decks].sort(cmp),
    tags: [...tags].sort(cmp),
    models: [...models].sort(cmp),
    hasUntagged,
  };
}

export type SortMode = "modified-desc" | "created-desc" | "created-asc";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "modified-desc", label: "Recently modified" },
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
];

const SORT_STORAGE_KEY = "ankitron:card-sort";

function isSortMode(value: string | null): value is SortMode {
  return SORT_OPTIONS.some((o) => o.value === value);
}

// A note's id is its creation time in epoch milliseconds; `mod` is the
// last-edit time in epoch seconds (falling back to creation when absent, e.g.
// for imports that didn't carry it).
function createdAt(note: Note): number {
  return note.noteId;
}
function modifiedAt(note: Note): number {
  return note.mod != null ? note.mod * 1000 : note.noteId;
}

function sortNotes(notes: Note[], mode: SortMode): Note[] {
  const sorted = [...notes];
  switch (mode) {
    case "created-asc":
      return sorted.sort((a, b) => createdAt(a) - createdAt(b));
    case "created-desc":
      return sorted.sort((a, b) => createdAt(b) - createdAt(a));
    case "modified-desc":
      return sorted.sort((a, b) => modifiedAt(b) - modifiedAt(a));
  }
}

interface UseNoteSearchOptions {
  deckName: string;
  /** Notes already scoped to the active segments; the search runs within these. */
  segmentNotes: Note[];
  /** A note's home deck, for the autocomplete's deck vocabulary. Wrap it in
   * useCallback — the derived results are memoized against it. */
  homeDeck: (note: Note) => string;
}

export function useNoteSearch({
  deckName,
  segmentNotes,
  homeDeck,
}: UseNoteSearchOptions) {
  const [query, setQuery] = useState("");
  // Note ids matching an operator query (deck:, is:, prop:, …), executed by
  // Anki's backend since it understands the full search syntax. Plain-text
  // queries skip this and stay on the instant in-memory filter. Keyed by
  // the query that produced it, so a stale result is ignored (not applied to a
  // newer query) and the in-flight list never flashes the wrong matches.
  const [backendResult, setBackendResult] = useState<{
    key: string;
    ids: Set<number>;
  } | null>(null);
  // A half-typed qualifier (`tag:`, `deck:` …) drops out, so the list behind
  // the open autocomplete menu stays put until a value is chosen.
  const effective = effectiveQuery(query);
  const useBackendSearch = effective !== "" && hasOperators(effective);

  // The query around the token being autocompleted (reported by SearchInput).
  // Autocomplete vocabulary is drawn from the notes matching *this*, so e.g. a
  // second `tag:` only offers tags that co-occur with the first one. Its own
  // (operator) result set is fetched separately when it differs from the
  // displayed query.
  const [contextQ, setContextQ] = useState("");
  const contextNeedsFetch =
    contextQ !== "" && contextQ !== effective && hasOperators(contextQ);
  const [contextResult, setContextResult] = useState<{
    key: string;
    ids: Set<number>;
  } | null>(null);
  useEffect(() => {
    if (!contextNeedsFetch) return;
    const key = contextQ;
    let cancelled = false;
    const handle = setTimeout(() => {
      findNoteIds(`deck:"${deckName}" (${key})`)
        .then((ids) => !cancelled && setContextResult({ key, ids: new Set(ids) }))
        .catch(() => !cancelled && setContextResult({ key, ids: new Set() }));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [contextQ, deckName, contextNeedsFetch]);

  // Run operator queries through Anki, scoped to this deck's subtree and ANDed
  // with the user's query (parenthesised so a top-level `or` can't escape the
  // scope). Debounced; an invalid query resolves to "no matches" rather than an
  // error. Segment scoping still happens client-side via segmentNotes.
  useEffect(() => {
    if (!useBackendSearch) return;
    const key = effective;
    let cancelled = false;
    const handle = setTimeout(() => {
      findNoteIds(`deck:"${deckName}" (${key})`)
        .then((ids) => !cancelled && setBackendResult({ key, ids: new Set(ids) }))
        .catch(() => !cancelled && setBackendResult({ key, ids: new Set() }));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [effective, deckName, useBackendSearch]);

  // The list reloads (window.location.reload) after edits, so persist the sort
  // choice in localStorage to keep it from resetting on every save.
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof localStorage === "undefined") return "modified-desc";
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    return isSortMode(saved) ? saved : "modified-desc";
  });
  function handleSortChange(mode: SortMode) {
    setSortMode(mode);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  // The displayed result set: notes matching the full (effective) query. Until
  // a pending operator query lands, notesForQuery falls back to the full scope
  // rather than flashing empty or stale matches.
  const matchedNotes = useMemo(
    () => notesForQuery(segmentNotes, effective, backendResult),
    [segmentNotes, effective, backendResult],
  );
  // Sort last so display order — and the selection ranges, "select all", and
  // keyboard nav that read it — all follow the chosen order. Memoized so a
  // selection change doesn't hand every row a fresh array (NoteRow is memo'd
  // against it via the checkbox handler).
  const filteredNotes = useMemo(
    () => sortNotes(matchedNotes, sortMode),
    [matchedNotes, sortMode],
  );

  // Notes the autocomplete vocabulary is drawn from: those matching the query
  // around the token being edited. When that context equals the displayed query
  // (e.g. the active token is an empty `tag:`, dropped from both), reuse the
  // already-computed result instead of refetching.
  const searchSources = useMemo(() => {
    const sourceNotes =
      contextQ === effective
        ? matchedNotes
        : notesForQuery(segmentNotes, contextQ, contextResult);
    return collectSources(sourceNotes, homeDeck);
  }, [contextQ, effective, matchedNotes, segmentNotes, contextResult, homeDeck]);

  return {
    query,
    setQuery,
    setContextQ,
    /** The displayed query with any half-typed qualifier dropped. */
    effective,
    sortMode,
    handleSortChange,
    filteredNotes,
    searchSources,
  };
}
