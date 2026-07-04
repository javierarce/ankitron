import {
  useState,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { createPortal } from "react-dom";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Checks } from "@phosphor-icons/react/dist/ssr/Checks";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Tag } from "@phosphor-icons/react/dist/ssr/Tag";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
import { SearchInput } from "./search-input";
import {
  effectiveQuery,
  hasOperators,
  type SuggestionSources,
} from "@/lib/search-query";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveCardDialog } from "./move-card-dialog";
import { BulkTagDialog, type TagChange } from "./bulk-tag-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import {
  createEditSequence,
  editSequencePrev,
  editSequenceNext,
  editSequenceSaved,
  editSequenceDeleted,
  editSequenceCurrentId,
  editSequenceCurrentNote,
  type EditSequence,
  type SequenceStep,
} from "@/lib/edit-sequence";
import { stripSoundTags } from "@/lib/audio";
import { noteDisplayFields } from "@/lib/note-fields";
import { deckLeaf, formatDeckPath, isCardInDeck } from "@/lib/deck";
import { foldText } from "@/lib/fold-text";
import { useVimNav } from "@/hooks/use-vim-nav";
import { isScrollLocked } from "@/hooks/use-scroll-lock";

/**
 * A segment's label, split into a dimmed parent path and the highlighted leaf,
 * relative to the deck being viewed: the deck itself is just its own leaf
 * ("Spanish"), and a subdeck shows the path beneath it
 * ("Spanish::Verbs::Irregular" → prefix "Verbs / ", leaf "Irregular").
 */
function segmentLabelParts(
  deck: string,
  parent: string,
): { prefix: string | null; leaf: string } {
  const rel = deck === parent ? deckLeaf(parent) : deck.slice(parent.length + 2);
  const parts = rel.split("::");
  const leaf = parts[parts.length - 1];
  const prefix = parts.length > 1 ? parts.slice(0, -1).join(" / ") + " / " : null;
  return { prefix, leaf };
}

/**
 * Centered placeholder shown when the card list has nothing to render — a fresh
 * empty deck, or a segment scoped to a (sub)deck that holds no cards.
 */
function EmptyState({ heading, hint }: { heading: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <FolderSimple size={32} weight="light" className="text-foreground/25" />
      <p className="text-sm font-medium text-foreground/70">{heading}</p>
      <p className="text-sm text-foreground/40">{hint}</p>
    </div>
  );
}

function decodeHtml(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

function stripHtml(html: string): string {
  return decodeHtml(stripSoundTags(html).replace(/<[^>]*>/g, "")).trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

function stripCloze(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)\}\}/g, (_, inner: string) => {
    const hintIdx = inner.lastIndexOf("::");
    return hintIdx === -1 ? inner : inner.slice(0, hintIdx);
  });
}

// A note's searchable text: its field values (HTML and cloze stripped) plus its
// tags, lowercased and diacritic-folded, for the plain-text substring filter.
function noteHaystack(note: Note): string {
  const text = Object.values(note.fields)
    .map((field) => field?.value)
    .filter(Boolean)
    .map((v) => stripCloze(stripHtml(v as string)))
    .concat(note.tags)
    .join(" ");
  return foldText(text);
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

type SortMode = "modified-desc" | "created-desc" | "created-asc";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
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

// A muted keyboard hint shown next to an action's label, so the single-key
// shortcuts (e/s/t) are discoverable from the controls that trigger them.
function Kbd({ children }: { children: string }) {
  return (
    // The hint font is smaller than the label it sits beside; flex centering
    // lands its tight line box a hair high, so nudge it down a pixel to line up
    // optically with the text baseline.
    <kbd className="relative top-px font-sans text-[11px] leading-none text-foreground/30">
      {children}
    </kbd>
  );
}

function CardMenu({
  onEdit,
  isSuspended,
  onToggleSuspend,
  onMove,
  onDelete,
}: {
  onEdit: () => void;
  isSuspended: boolean;
  onToggleSuspend: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portal + flip-aware placement so a row near the bottom of the (scrollable)
  // note list opens its menu upward instead of off-screen.
  const { style } = useMenuPlacement(open, btnRef, menuRef);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Note actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60"
      >
        <DotsThreeVertical size={22} weight="bold" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="z-50 flex w-max flex-col overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
          >
          <button
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            <span>Edit</span>
            <Kbd>E</Kbd>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onToggleSuspend();
            }}
            className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            <span>{isSuspended ? "Unsuspend" : "Suspend"}</span>
            <Kbd>S</Kbd>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onMove();
            }}
            className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            <span>Move to deck&hellip;</span>
            <Kbd>M</Kbd>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-red-500 hover:bg-foreground/5 transition-colors"
          >
            Delete
          </button>
          </div>,
          document.body,
        )}
    </>
  );
}

interface CardListProps {
  deckName: string;
  notes: Note[];
  suspendedCardIds?: number[];
  /** Each note's home deck. Lets the list scope to one subdeck via the segments. */
  noteDecks?: Record<number, string>;
  /** Decks nested under this one, sorted as a tree. Drives the segmented control. */
  subdecks?: string[];
  /** Called after cards are suspended or unsuspended, so the parent can refresh due counts. */
  onSuspendChange?: () => void;
  /** Called after cards are moved between (sub)decks, so the parent can refresh due counts. */
  onCardsMoved?: () => void;
  /**
   * Called after a card is added, edited, or deleted so the parent can refetch
   * the list in place. Without it these actions fall back to a full page
   * reload, which blanks the whole app.
   */
  onChanged?: () => void;
  /** Add-card form visibility, owned by the page so the button can live in its header. */
  showAddForm: boolean;
  onShowAddForm: (show: boolean) => void;
  /** Segments to pre-select on mount, e.g. when returning from a scoped study session. */
  initialSegments?: string[];
  /**
   * Called with the currently selected segment deck names whenever they change,
   * so the page header's Study button can scope a session to those subdecks.
   * Empty = "All" selected.
   */
  onSegmentsChange?: (segments: string[]) => void;
}

export function CardList({
  deckName,
  notes,
  suspendedCardIds,
  noteDecks,
  subdecks,
  onSuspendChange,
  onCardsMoved,
  onChanged,
  showAddForm,
  onShowAddForm,
  initialSegments,
  onSegmentsChange,
}: CardListProps) {
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingNote, setMovingNote] = useState<Note | null>(null);
  const [suspended, setSuspended] = useState<Set<number>>(() => new Set(suspendedCardIds ?? []));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Note ids matching an operator query (deck:, is:, prop:, …), executed by
  // Anki's backend since it understands the full search syntax. Plain-text
  // queries skip this and stay on the instant in-memory filter below. Keyed by
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
      ankiFetch<number[]>("findNotes", { query: `deck:"${deckName}" (${key})` })
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
  // error. Segment scoping still happens client-side via segmentNotes below.
  useEffect(() => {
    if (!useBackendSearch) return;
    const key = effective;
    let cancelled = false;
    const handle = setTimeout(() => {
      ankiFetch<number[]>("findNotes", { query: `deck:"${deckName}" (${key})` })
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

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const lastSelectedRef = useRef<number | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTagging, setBulkTagging] = useState(false);

  // The last bulk tag change, kept briefly so Cmd+Z can reverse it. Auto-expires
  // so the undo window is short and predictable rather than reaching back across
  // unrelated edits.
  const [tagUndo, setTagUndo] = useState<TagChange | null>(null);
  const tagUndoTimer = useRef<number | null>(null);

  function clearTagUndo() {
    if (tagUndoTimer.current !== null) {
      window.clearTimeout(tagUndoTimer.current);
      tagUndoTimer.current = null;
    }
    setTagUndo(null);
  }

  function armTagUndo(change: TagChange | null) {
    if (tagUndoTimer.current !== null) window.clearTimeout(tagUndoTimer.current);
    setTagUndo(change);
    tagUndoTimer.current = change
      ? window.setTimeout(() => setTagUndo(null), 10000)
      : null;
  }

  async function handleTagUndo() {
    const change = tagUndo;
    if (!change) return;
    clearTagUndo();
    try {
      for (const op of change.ops) {
        await ankiFetch(op.action, { notes: op.noteIds, tags: op.tag });
      }
      refreshAfterChange();
    } catch {
      // A failed undo just stays undone rather than retrying in a loop.
    }
  }

  useEffect(() => () => clearTagUndo(), []);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Sequential edit run: the note editor opens one selected note at a time, and
  // "Update Note" (or Skip) advances. The cursor logic lives in lib/edit-sequence
  // so it can be tested without rendering the editor.
  const [editSeq, setEditSeq] = useState<EditSequence | null>(null);
  // Confirmation for deleting the card currently open in the edit run.
  const [seqDeleteOpen, setSeqDeleteOpen] = useState(false);
  const [seqDeleting, setSeqDeleting] = useState(false);

  function beginEdit(ids: number[]) {
    setEditSeq(createEditSequence(ids));
  }

  // Refresh the list in place after a write. Falls back to a full page reload
  // only if the parent didn't wire up an in-place refresh.
  const refreshAfterChange = onChanged ?? (() => window.location.reload());

  // Resync the list once the run finishes, and only if something was actually
  // written.
  function finishEdit(dirty: boolean) {
    setEditSeq(null);
    if (dirty) refreshAfterChange();
  }

  function applyStep(step: SequenceStep) {
    if (step.done) finishEdit(step.dirty);
    else setEditSeq(step.seq);
  }

  // Delete the card open in the run, then drop it from the sequence and show the
  // next one (or finish if it was the last). The list reloads on finish.
  async function handleSeqDelete() {
    if (!editSeq) return;
    setSeqDeleting(true);
    try {
      await ankiFetch("deleteNotes", { notes: [editSequenceCurrentId(editSeq)] });
      setSeqDeleteOpen(false);
      applyStep(editSequenceDeleted(editSeq));
    } catch {
      setSeqDeleteOpen(false);
    } finally {
      setSeqDeleting(false);
    }
  }

  // Each note's home deck, kept locally so a drag-move updates the list in place
  // instead of forcing a reload. Seeded from the prop and re-seeded when it
  // changes (adjusting state during render rather than in an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect).
  const [decks, setDecks] = useState<Record<number, string>>(noteDecks ?? {});
  const [prevNoteDecks, setPrevNoteDecks] = useState(noteDecks);
  if (noteDecks !== prevNoteDecks) {
    setPrevNoteDecks(noteDecks);
    setDecks(noteDecks ?? {});
  }

  // Which segments are active. Empty = "All"; otherwise the list is scoped to
  // the union of these exact deck names. Cmd/Ctrl+click toggles a segment into
  // the set; Shift+click extends a range from the last-clicked one; a plain
  // click selects just one (or clears it back to "All").
  const [activeSegments, setActiveSegments] = useState<Set<string>>(
    () => new Set(initialSegments),
  );
  // The last segment clicked, used as the anchor for Shift+click ranges.
  const [lastSegment, setLastSegment] = useState<string | null>(null);
  // Reset back to "All" whenever we navigate to a different deck.
  const [prevDeckName, setPrevDeckName] = useState(deckName);
  if (deckName !== prevDeckName) {
    setPrevDeckName(deckName);
    setActiveSegments(new Set());
    setLastSegment(null);
    setTagUndo(null);
  }

  // Surface the active segment selection to the page so its Study button can
  // scope a session to those subdecks.
  useEffect(() => {
    onSegmentsChange?.([...activeSegments]);
  }, [activeSegments, onSegmentsChange]);

  function handleSegmentClick(deck: string, e: ReactMouseEvent) {
    const anchor = lastSegment;
    if (e.shiftKey && anchor) {
      // Add every segment between the anchor and this one (inclusive) to the
      // current selection, ordered by the chip row (deck + its subdecks).
      const anchorIdx = segmentDecks.indexOf(anchor);
      const clickedIdx = segmentDecks.indexOf(deck);
      if (anchorIdx !== -1 && clickedIdx !== -1) {
        const [start, end] =
          anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        setActiveSegments((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(segmentDecks[i]);
          return next;
        });
        setLastSegment(deck);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setActiveSegments((prev) => {
        const next = new Set(prev);
        if (next.has(deck)) next.delete(deck);
        else next.add(deck);
        return next;
      });
    } else {
      // Plain click: select just this segment, or clear it if it was already
      // the sole selection.
      setActiveSegments((prev) =>
        prev.size === 1 && prev.has(deck) ? new Set() : new Set([deck]),
      );
    }
    setLastSegment(deck);
  }

  // The deck a card is currently being dragged over, for drop-target highlight.
  const [dragOverDeck, setDragOverDeck] = useState<string | null>(null);
  // The note ids in the active drag (one card, or the whole selection).
  const draggingRef = useRef<number[]>([]);
  // The off-screen element used as the drag preview, torn down on drag end.
  const dragImageRef = useRef<HTMLElement | null>(null);

  // One chip per subdeck. The root deck isn't a chip: studying it would pull in
  // every subdeck anyway (Anki reviews a deck's whole subtree), so scoping to it
  // is exactly what "All" does — a separate root chip just sets a count that the
  // study session can't honour.
  const hasSegments = (subdecks?.length ?? 0) > 0;
  const segmentDecks = subdecks ?? [];

  const hasDialog =
    showAddForm ||
    !!editingNote ||
    !!deletingNote ||
    !!movingNote ||
    bulkMoving ||
    bulkTagging ||
    bulkDeleteOpen ||
    !!editSeq;

  useVimNav({ enabled: !hasDialog });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasDialog) return;
      // A modal overlay above the list (e.g. the command palette) holds the
      // scroll lock; don't let list shortcuts fire behind it.
      if (isScrollLocked()) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (inField) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "z" || e.key === "Z") &&
        !e.shiftKey &&
        tagUndo
      ) {
        e.preventDefault();
        handleTagUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        if (rows.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(rows.map((el) => Number(el.dataset.noteId))));
        }
        return;
      }
      if (e.key === "Escape") {
        const focusedRow = (document.activeElement as HTMLElement | null)?.closest?.(
          "[data-note-id]"
        ) as HTMLElement | null;
        if (selectedIds.size > 0 || focusedRow) {
          e.preventDefault();
          if (selectedIds.size > 0) setSelectedIds(new Set());
          focusedRow?.blur();
        }
        return;
      }
      if (e.key === " " || e.code === "Space") {
        // Only toggle the focused row. Falling back to the hovered row would
        // hijack Space-to-scroll for mouse users, since the cursor usually
        // rests over the list while reading.
        const row = target?.closest("[data-note-id]") as HTMLElement | null;
        if (row) {
          e.preventDefault();
          const id = Number(row.dataset.noteId);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
          lastSelectedRef.current = id;
        }
        return;
      }
      if (
        (e.key === "J" || e.key === "K") &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        // Shift + j/k: move focus like j/k, extending the selection along the
        // way. (vim-nav handles lowercase j/k; Shift yields J/K, so there's no
        // double-handling.)
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        if (rows.length === 0) return;
        const dir = e.key === "J" ? 1 : -1;
        const active = document.activeElement as HTMLElement | null;
        const focusIdx = active ? rows.indexOf(active) : -1;
        const fromIdx = focusIdx < 0 ? (dir === 1 ? -1 : rows.length) : focusIdx;
        const targetIdx = Math.min(rows.length - 1, Math.max(0, fromIdx + dir));
        e.preventDefault();
        const ids: number[] = [];
        if (focusIdx >= 0) ids.push(Number(rows[focusIdx].dataset.noteId));
        ids.push(Number(rows[targetIdx].dataset.noteId));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
        const targetEl = rows[targetIdx];
        targetEl.focus();
        targetEl.scrollIntoView({ block: "nearest" });
        lastSelectedRef.current = Number(targetEl.dataset.noteId);
        return;
      }
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onShowAddForm(true);
        return;
      }
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Edit the selection in display order; with nothing selected, edit the
        // focused row as a run of one. Read ids from the DOM so the order and
        // membership stay current without this handler depending on the notes.
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        let ids = rows
          .map((el) => Number(el.dataset.noteId))
          .filter((id) => selectedIds.has(id));
        if (ids.length === 0) {
          const focusedRow = (
            document.activeElement as HTMLElement | null
          )?.closest?.("[data-note-id]") as HTMLElement | null;
          if (focusedRow) ids = [Number(focusedRow.dataset.noteId)];
        }
        if (ids.length > 0) {
          e.preventDefault();
          beginEdit(ids);
        }
        return;
      }
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Tag the selection; with nothing selected, tag the focused row by
        // selecting it first so the dialog (which reads the selection) has it.
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        let ids = rows
          .map((el) => Number(el.dataset.noteId))
          .filter((id) => selectedIds.has(id));
        if (ids.length === 0) {
          const focusedRow = (
            document.activeElement as HTMLElement | null
          )?.closest?.("[data-note-id]") as HTMLElement | null;
          if (focusedRow) ids = [Number(focusedRow.dataset.noteId)];
        }
        if (ids.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(ids));
          setBulkTagging(true);
        }
        return;
      }
      if (e.key === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Suspend the selection; with nothing selected, act on the focused row.
        // Like the row menu, this toggles a note's cards together, so the
        // suspended badge stays accurate. Unsuspend only when every target note
        // is already suspended; otherwise suspend (matches the bulk action).
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        let ids = rows
          .map((el) => Number(el.dataset.noteId))
          .filter((id) => selectedIds.has(id));
        if (ids.length === 0) {
          const focusedRow = (
            document.activeElement as HTMLElement | null
          )?.closest?.("[data-note-id]") as HTMLElement | null;
          if (focusedRow) ids = [Number(focusedRow.dataset.noteId)];
        }
        const idSet = new Set(ids);
        const targetNotes = notes.filter((n) => idSet.has(n.noteId));
        const cardIds = targetNotes.flatMap((n) => n.cards ?? []);
        if (cardIds.length === 0) return;
        e.preventDefault();
        const allSuspended = targetNotes.every((n) =>
          (n.cards ?? []).some((id) => suspended.has(id))
        );
        ankiFetch(allSuspended ? "unsuspend" : "suspend", { cards: cardIds })
          .then(() => {
            setSuspended((prev) => {
              const next = new Set(prev);
              for (const id of cardIds) {
                if (allSuspended) next.delete(id);
                else next.add(id);
              }
              return next;
            });
            onSuspendChange?.();
          })
          .catch(() => {
            // silently fail
          });
        return;
      }
      if (e.key === "m" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Move the selection; with nothing selected, move the focused row by
        // selecting it first so the dialog (which reads the selection) has it.
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        let ids = rows
          .map((el) => Number(el.dataset.noteId))
          .filter((id) => selectedIds.has(id));
        if (ids.length === 0) {
          const focusedRow = (
            document.activeElement as HTMLElement | null
          )?.closest?.("[data-note-id]") as HTMLElement | null;
          if (focusedRow) ids = [Number(focusedRow.dataset.noteId)];
        }
        if (ids.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(ids));
          setBulkMoving(true);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasDialog, selectedIds, tagUndo, notes, suspended, onSuspendChange]);

  // Scope to the active segments first; "All" (empty set) keeps every note. A
  // segment covers its whole subtree, so a chip for a parent deck (e.g.
  // "Deutsch") includes every note under it — matching the count on the chip
  // and what a study session for it would review. A note's deck falls back to
  // the viewed deck if cardsInfo hasn't loaded its mapping yet.
  const activeSegmentList = [...activeSegments];
  const segmentNotes =
    activeSegments.size === 0
      ? notes
      : notes.filter((note) => {
          const home = decks[note.noteId] ?? deckName;
          return activeSegmentList.some((seg) => isCardInDeck(home, seg));
        });

  // The displayed result set: notes matching the full (effective) query. Until
  // a pending operator query lands, notesForQuery falls back to the full scope
  // rather than flashing empty or stale matches.
  const matchedNotes = notesForQuery(segmentNotes, effective, backendResult);
  // Sort last so display order — and the selection ranges, "select all", and
  // keyboard nav that read it — all follow the chosen order.
  const filteredNotes = sortNotes(matchedNotes, sortMode);

  // Notes the autocomplete vocabulary is drawn from: those matching the query
  // around the token being edited. When that context equals the displayed query
  // (e.g. the active token is an empty `tag:`, dropped from both), reuse the
  // already-computed result instead of refetching.
  const homeDeck = (note: Note) => decks[note.noteId] ?? deckName;
  const sourceNotes =
    contextQ === effective
      ? matchedNotes
      : notesForQuery(segmentNotes, contextQ, contextResult);
  const searchSources = collectSources(sourceNotes, homeDeck);

  function isNoteSuspended(note: Note): boolean {
    return (note.cards ?? []).some((id) => suspended.has(id));
  }

  async function handleToggleSuspend(note: Note) {
    const cardIds = note.cards ?? [];
    if (cardIds.length === 0) return;
    const isSuspended = isNoteSuspended(note);
    try {
      await ankiFetch(isSuspended ? "unsuspend" : "suspend", { cards: cardIds });
      setSuspended((prev) => {
        const next = new Set(prev);
        for (const id of cardIds) {
          if (isSuspended) next.delete(id);
          else next.add(id);
        }
        return next;
      });
      onSuspendChange?.();
    } catch {
      // silently fail
    }
  }

  async function handleDelete() {
    if (!deletingNote) return;
    setDeleting(true);
    try {
      await ankiFetch("deleteNotes", { notes: [deletingNote.noteId] });
      setDeletingNote(null);
      // Close the editor too — it may have been the delete's entry point.
      setEditingNote(null);
      refreshAfterChange();
    } catch {
      setDeletingNote(null);
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelected(noteId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function handleCheckboxClick(e: ReactMouseEvent, note: Note) {
    e.stopPropagation();
    const anchorId = lastSelectedRef.current;
    if (e.shiftKey && anchorId !== null) {
      const anchorIdx = filteredNotes.findIndex((n) => n.noteId === anchorId);
      const clickedIdx = filteredNotes.findIndex((n) => n.noteId === note.noteId);
      if (anchorIdx !== -1 && clickedIdx !== -1) {
        const [start, end] =
          anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(filteredNotes[i].noteId);
          return next;
        });
        lastSelectedRef.current = note.noteId;
        return;
      }
    }
    toggleSelected(note.noteId);
    lastSelectedRef.current = note.noteId;
  }

  function clearSelection() {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }

  const selectedNotes = notes.filter((n) => selectedIds.has(n.noteId));
  const selectionActive = selectedNotes.length > 0;
  const allSelectedSuspended =
    selectionActive && selectedNotes.every((n) => isNoteSuspended(n));

  const allVisibleSelected =
    filteredNotes.length > 0 &&
    filteredNotes.every((note) => selectedIds.has(note.noteId));

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const note of filteredNotes) next.add(note.noteId);
      return next;
    });
  }

  async function handleBulkSuspend(suspend: boolean) {
    const cardIds = selectedNotes.flatMap((n) => n.cards ?? []);
    if (cardIds.length === 0) return;
    try {
      await ankiFetch(suspend ? "suspend" : "unsuspend", { cards: cardIds });
      setSuspended((prev) => {
        const next = new Set(prev);
        for (const id of cardIds) {
          if (suspend) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      onSuspendChange?.();
    } catch {
      // silently fail
    }
  }

  async function handleBulkDelete() {
    if (selectedNotes.length === 0) return;
    setBulkDeleting(true);
    try {
      await ankiFetch("deleteNotes", {
        notes: selectedNotes.map((n) => n.noteId),
      });
      setBulkDeleteOpen(false);
      clearSelection();
      refreshAfterChange();
    } catch {
      setBulkDeleteOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  }

  // How many notes live in each subdeck's subtree, for the segment badges. A
  // parent deck counts every note beneath it, so the badge matches what
  // selecting the chip scopes the list to (and what studying it would review)
  // rather than only the notes filed directly in that deck.
  const countByDeck = new Map<string, number>();
  for (const note of notes) {
    const home = decks[note.noteId] ?? deckName;
    for (const seg of segmentDecks) {
      if (isCardInDeck(home, seg)) {
        countByDeck.set(seg, (countByDeck.get(seg) ?? 0) + 1);
      }
    }
  }

  // When the selected segment(s) hold no notes, hide the search field, count,
  // and "no match" message and show a dedicated empty state instead.
  const segmentScopeEmpty = activeSegments.size > 0 && segmentNotes.length === 0;
  // Nothing to search or count: a fresh empty deck, or an empty segment scope.
  // Both fall through to the EmptyState, so suppress the search box and count.
  const listEmpty = segmentScopeEmpty || notes.length === 0;
  const onlySegment = activeSegments.size === 1 ? [...activeSegments][0] : null;
  const emptySegmentLabel = onlySegment
    ? (() => {
        const { prefix, leaf } = segmentLabelParts(onlySegment, deckName);
        return (prefix ?? "") + leaf;
      })()
    : "the selected decks";

  // Move the given notes into a target (sub)deck, updating the list in place
  // rather than reloading. Notes already in the target are skipped.
  async function moveNotesToDeck(noteList: Note[], target: string) {
    const toMove = noteList.filter((n) => (decks[n.noteId] ?? deckName) !== target);
    if (toMove.length === 0) return;
    let cardIds = toMove.flatMap((n) => n.cards ?? []);
    if (cardIds.length === 0) {
      cardIds = await ankiFetch<number[]>("findCards", {
        query: toMove.map((n) => `nid:${n.noteId}`).join(" OR "),
      });
    }
    if (cardIds.length === 0) return;
    try {
      await ankiFetch("changeDeck", { cards: cardIds, deck: target });
      // changeDeck writes raw SQL; rebuild Anki's scheduler queues so an active
      // reviewer doesn't keep serving the moved card.
      await ankiFetch("reloadCollection").catch(() => {});
      setDecks((prev) => {
        const next = { ...prev };
        for (const n of toMove) next[n.noteId] = target;
        return next;
      });
      // Drop the moved notes from the selection — they've left the current view.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const n of toMove) next.delete(n.noteId);
        return next;
      });
      onCardsMoved?.();
    } catch {
      // Leave the list untouched if the move fails.
    }
  }

  function clearDragImage() {
    dragImageRef.current?.remove();
    dragImageRef.current = null;
  }

  function handleRowDragStart(e: ReactDragEvent, note: Note) {
    // Drag the whole selection when the grabbed card is part of it; otherwise
    // just the one card.
    const ids = selectedIds.has(note.noteId)
      ? Array.from(selectedIds)
      : [note.noteId];
    draggingRef.current = ids;
    // "copyMove" so the drop targets can show a "copy" (+) cursor — on macOS the
    // plain "move" cursor is indistinguishable from the default arrow, making
    // the segments look like they don't accept the drop.
    e.dataTransfer.effectAllowed = "copyMove";
    // Firefox requires data to be set for the drag to start at all.
    e.dataTransfer.setData("text/plain", ids.join(","));

    // Replace the default (semi-transparent row) preview with a solid count
    // badge. The element must live in the DOM when the browser snapshots it, so
    // it sits off-screen until drag end clears it. A transparent-padded wrapper
    // lets us put the cursor hotspot at its top-left (0, 0) so the pill trails
    // just below-right of the pointer instead of sitting under it.
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position: "fixed",
      top: "-9999px",
      left: "-9999px",
      // Top/left set the cursor-to-pill gap; right/bottom just leave room so the
      // pill's drop shadow isn't clipped out of the snapshot.
      paddingTop: "14px",
      paddingLeft: "16px",
      paddingRight: "20px",
      paddingBottom: "26px",
      pointerEvents: "none",
    });
    const badge = document.createElement("div");
    badge.textContent = ids.length === 1 ? "1 note" : `${ids.length} notes`;
    Object.assign(badge.style, {
      padding: "0.375rem 0.75rem",
      borderRadius: "9999px",
      fontSize: "0.875rem",
      fontWeight: "600",
      whiteSpace: "nowrap",
      background: "var(--foreground)",
      color: "var(--background)",
      boxShadow: "0 6px 16px rgba(0, 0, 0, 0.25)",
    });
    wrapper.appendChild(badge);
    document.body.appendChild(wrapper);
    dragImageRef.current = wrapper;
    e.dataTransfer.setDragImage(wrapper, 0, 0);
  }

  function handleSegmentDrop(target: string) {
    const ids = draggingRef.current;
    draggingRef.current = [];
    setDragOverDeck(null);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    void moveNotesToDeck(
      notes.filter((n) => idSet.has(n.noteId)),
      target,
    );
  }

  return (
    <div>
      {hasSegments && (
        // A horizontal segmented control: "All" plus one chip per subdeck.
        // Tap to scope the list to a subdeck; drag cards onto a chip to move
        // them there. Scrolls sideways when the decks overflow the row.
        <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          <button
            onClick={() => {
              setActiveSegments(new Set());
              setLastSegment(null);
            }}
            // Dropping onto "All" moves cards to the root deck — the only way to
            // reach it by drag now that the root has no chip of its own.
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragOverDeck(deckName);
            }}
            onDragLeave={() =>
              setDragOverDeck((prev) => (prev === deckName ? null : prev))
            }
            onDrop={(e) => {
              e.preventDefault();
              handleSegmentDrop(deckName);
            }}
            title={`Drop here to move to ${deckLeaf(deckName)}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
              activeSegments.size === 0
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-foreground/5"
            } ${
              dragOverDeck === deckName
                ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                : ""
            }`}
          >
            All
            <span className="ml-1.5 opacity-50 tabular-nums">{notes.length}</span>
          </button>
          {segmentDecks.map((d) => {
            const active = activeSegments.has(d);
            // A subdeck sitting under a selected parent is part of the scope
            // without being picked itself — give it a lighter highlight so the
            // covered subtree reads at a glance.
            const covered =
              !active && activeSegmentList.some((seg) => isCardInDeck(d, seg));
            const isDragOver = dragOverDeck === d;
            const { prefix, leaf } = segmentLabelParts(d, deckName);
            return (
              <button
                key={d}
                onClick={(e) => handleSegmentClick(d, e)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDragOverDeck(d);
                }}
                onDragLeave={() =>
                  setDragOverDeck((prev) => (prev === d ? null : prev))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  handleSegmentDrop(d);
                }}
                title={formatDeckPath(d)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : covered
                      ? "border-foreground/30 bg-foreground/10 hover:bg-foreground/15"
                      : "border-border hover:bg-foreground/5"
                } ${
                  isDragOver
                    ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                    : ""
                }`}
              >
                {prefix && <span className="opacity-50">{prefix}</span>}
                {leaf}
                <span className="ml-1.5 opacity-50 tabular-nums">
                  {countByDeck.get(d) ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!listEmpty && (
        <div className="mb-4 flex items-center gap-3">
          <SearchInput
            ref={searchRef}
            value={query}
            onChange={setQuery}
            sources={searchSources}
            onContextChange={setContextQ}
            placeholder="Search notes…"
            className="flex-1"
          />
        </div>
      )}

      {!listEmpty && (
      <div className="mb-4 flex h-9 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {selectionActive ? (
            <>
              <p className="text-sm font-medium">
                {selectedNotes.length}{" "}
                {selectedNotes.length === 1 ? "note" : "notes"} selected
              </p>
              {!allVisibleSelected && (
                <button
                  onClick={selectAllVisible}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
                >
                  <Checks size={15} weight="bold" />
                  Select all
                </button>
              )}
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
              >
                <X size={14} weight="bold" />
                Clear
              </button>
            </>
          ) : (
            <p className="text-sm text-foreground/50">
              {effective
                ? `${filteredNotes.length} of ${segmentNotes.length} ${segmentNotes.length === 1 ? "note" : "notes"}`
                : `${segmentNotes.length} ${segmentNotes.length === 1 ? "note" : "notes"}`}
            </p>
          )}
        </div>
        {!selectionActive && (
          <select
            value={sortMode}
            onChange={(e) => handleSortChange(e.target.value as SortMode)}
            aria-label="Sort notes"
            className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground/70 hover:bg-foreground/5 focus:outline-none focus:border-foreground/30 transition-colors cursor-pointer"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {selectionActive && (
          <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  beginEdit(
                    filteredNotes
                      .filter((n) => selectedIds.has(n.noteId))
                      .map((n) => n.noteId),
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                <PencilSimple size={16} weight="bold" />
                Edit
                <Kbd>E</Kbd>
              </button>
              <button
                onClick={() => handleBulkSuspend(!allSelectedSuspended)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                {allSelectedSuspended ? (
                  <>
                    <Play size={16} weight="bold" />
                    Unsuspend
                  </>
                ) : (
                  <>
                    <Pause size={16} weight="bold" />
                    Suspend
                  </>
                )}
                <Kbd>S</Kbd>
              </button>
              <button
                onClick={() => setBulkMoving(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                <FolderSimple size={16} weight="bold" />
                Move
                <Kbd>M</Kbd>
              </button>
              <button
                onClick={() => setBulkTagging(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                <Tag size={16} weight="bold" />
                Tag
                <Kbd>T</Kbd>
              </button>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash size={16} weight="bold" />
                Delete
              </button>
          </div>
        )}
      </div>
      )}

      {segmentScopeEmpty ? (
        <EmptyState
          heading={`No notes in ${emptySegmentLabel}`}
          hint="Drag notes from another deck onto it to move them here."
        />
      ) : notes.length === 0 ? (
        <EmptyState
          heading={`No notes in ${deckLeaf(deckName)}`}
          hint="Add your first note to get started."
        />
      ) : filteredNotes.length === 0 ? (
        <p className="text-foreground/50">No notes match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="space-y-2">
          {filteredNotes.map((note) => {
            const noteSuspended = isNoteSuspended(note);
            const selected = selectedIds.has(note.noteId);
            return (
              <div
                key={note.noteId}
                data-nav-item
                data-note-id={note.noteId}
                data-selected={selected || undefined}
                role="button"
                tabIndex={0}
                draggable={hasSegments}
                onDragStart={(e) => handleRowDragStart(e, note)}
                onDragEnd={() => {
                  draggingRef.current = [];
                  setDragOverDeck(null);
                  clearDragImage();
                }}
                onClick={() => setEditingNote(note)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEditingNote(note);
                  }
                }}
                className={`group relative flex select-none items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-[background-color] ${
                  selected
                    ? "border-foreground/40 bg-foreground/[0.05]"
                    : "border-border hover:bg-foreground/[0.02]"
                } ${noteSuspended && !selected ? "bg-foreground/[0.03]" : ""}`}
              >
                <button
                  onClick={(e) => handleCheckboxClick(e, note)}
                  aria-label={selected ? "Deselect note" : "Select note"}
                  aria-pressed={selected}
                  className="relative z-10 -m-2 flex shrink-0 items-center justify-center self-start p-2"
                >
                  <span
                    className={`flex h-5 w-5 translate-y-[2px] items-center justify-center rounded border transition-all ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/25 text-transparent group-hover:border-foreground/50"
                    }`}
                  >
                    <Check size={13} weight="bold" />
                  </span>
                </button>
                <div className={`flex-1 min-w-0 ${noteSuspended ? "opacity-50" : ""}`}>
                  {(() => {
                    const { primary, secondary } = noteDisplayFields(note);
                    return (
                      <>
                        <p className="text-sm font-medium">
                          {truncate(stripCloze(stripHtml(primary)), 80)}
                        </p>
                        {secondary && (
                          <p className="text-sm text-foreground/50 mt-0.5">
                            {truncate(stripCloze(stripHtml(secondary)), 80)}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {note.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {note.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs text-foreground/60"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CardMenu
                    onEdit={() => setEditingNote(note)}
                    isSuspended={noteSuspended}
                    onToggleSuspend={() => handleToggleSuspend(note)}
                    onMove={() => setMovingNote(note)}
                    onDelete={() => setDeletingNote(note)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <CardForm
          deckName={deckName}
          onClose={() => onShowAddForm(false)}
          onSaved={() => {
            onShowAddForm(false);
            refreshAfterChange();
          }}
        />
      )}

      {editingNote && (
        <CardForm
          deckName={deckName}
          note={editingNote}
          onDelete={() => setDeletingNote(editingNote)}
          blocked={!!deletingNote}
          onClose={() => setEditingNote(null)}
          onSaved={() => {
            setEditingNote(null);
            refreshAfterChange();
          }}
        />
      )}

      {editSeq &&
        (() => {
          const note = editSequenceCurrentNote(editSeq, notes);
          if (!note) return null;
          return (
            <CardForm
              key={editSequenceCurrentId(editSeq)}
              deckName={deckName}
              note={note}
              position={{ index: editSeq.index, total: editSeq.ids.length }}
              onPrev={() => setEditSeq(editSequencePrev(editSeq))}
              onSkip={() => applyStep(editSequenceNext(editSeq))}
              onDelete={() => setSeqDeleteOpen(true)}
              blocked={seqDeleteOpen}
              onSaved={(updated) => applyStep(editSequenceSaved(editSeq, updated))}
              onClose={() => finishEdit(editSeq.dirty)}
            />
          );
        })()}

      {seqDeleteOpen &&
        editSeq &&
        (() => {
          const note = editSequenceCurrentNote(editSeq, notes);
          const preview = note
            ? truncate(stripCloze(stripHtml(noteDisplayFields(note).primary)), 50)
            : "";
          return (
            <ConfirmDialog
              title="Delete Note"
              message={preview ? `Delete "${preview}"?` : "Delete this note?"}
              onConfirm={handleSeqDelete}
              onCancel={() => setSeqDeleteOpen(false)}
              loading={seqDeleting}
            />
          );
        })()}

      {movingNote && (
        <MoveCardDialog
          notes={[movingNote]}
          currentDeck={deckName}
          onClose={() => setMovingNote(null)}
          onMoved={() => {
            setMovingNote(null);
            refreshAfterChange();
          }}
        />
      )}

      {bulkMoving && (
        <MoveCardDialog
          notes={selectedNotes}
          currentDeck={deckName}
          onClose={() => setBulkMoving(false)}
          onMoved={() => {
            setBulkMoving(false);
            clearSelection();
            refreshAfterChange();
          }}
        />
      )}

      {bulkTagging && (
        <BulkTagDialog
          notes={selectedNotes}
          onClose={() => setBulkTagging(false)}
          onTagged={(change) => {
            // Tagging leaves the notes in place, so keep the selection — unlike
            // Move/Delete, the user is likely to act on the same set again.
            setBulkTagging(false);
            armTagUndo(change);
            refreshAfterChange();
          }}
        />
      )}

      {bulkDeleteOpen && (
        <ConfirmDialog
          title={
            selectedNotes.length === 1 ? "Delete Note" : "Delete Notes"
          }
          message={
            selectedNotes.length === 1
              ? "Delete the selected note?"
              : `Delete ${selectedNotes.length} selected notes?`
          }
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
          loading={bulkDeleting}
        />
      )}

      {deletingNote && (
        <ConfirmDialog
          title="Delete Note"
          message={`Delete "${truncate(
            stripCloze(stripHtml(noteDisplayFields(deletingNote).primary)),
            50
          )}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeletingNote(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
