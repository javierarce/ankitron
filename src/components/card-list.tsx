import {
  useState,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Checks } from "@phosphor-icons/react/dist/ssr/Checks";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveCardDialog } from "./move-card-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { stripSoundTags } from "@/lib/audio";
import { deckLeaf, formatDeckPath } from "@/lib/deck";
import { useVimNav } from "@/hooks/use-vim-nav";

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

function isClozeNote(note: Note): boolean {
  return (
    note.modelName === "Cloze" ||
    note.modelName === "Cloze (typed)" ||
    "Text" in note.fields
  );
}

function CardMenu({
  isSuspended,
  onToggleSuspend,
  onMove,
  onDelete,
}: {
  isSuspended: boolean;
  onToggleSuspend: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60"
      >
        <DotsThreeVertical size={22} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-lg border border-foreground/10 bg-background py-1 shadow-lg">
          <button
            onClick={() => {
              setOpen(false);
              onToggleSuspend();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            {isSuspended ? "Unsuspend" : "Suspend"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onMove();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            Move to deck&hellip;
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
        </div>
      )}
    </div>
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
  /** Add-card form visibility, owned by the page so the button can live in its header. */
  showAddForm: boolean;
  onShowAddForm: (show: boolean) => void;
}

export function CardList({
  deckName,
  notes,
  suspendedCardIds,
  noteDecks,
  subdecks,
  onSuspendChange,
  onCardsMoved,
  showAddForm,
  onShowAddForm,
}: CardListProps) {
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingNote, setMovingNote] = useState<Note | null>(null);
  const [suspended, setSuspended] = useState<Set<number>>(() => new Set(suspendedCardIds ?? []));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const lastSelectedRef = useRef<number | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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
  const [activeSegments, setActiveSegments] = useState<Set<string>>(() => new Set());
  // The last segment clicked, used as the anchor for Shift+click ranges.
  const [lastSegment, setLastSegment] = useState<string | null>(null);
  // Reset back to "All" whenever we navigate to a different deck.
  const [prevDeckName, setPrevDeckName] = useState(deckName);
  if (deckName !== prevDeckName) {
    setPrevDeckName(deckName);
    setActiveSegments(new Set());
    setLastSegment(null);
  }

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

  // The segmented control covers this deck plus every nested subdeck.
  const hasSegments = (subdecks?.length ?? 0) > 0;
  const segmentDecks = [deckName, ...(subdecks ?? [])];

  const hasDialog =
    showAddForm || !!editingNote || !!deletingNote || !!movingNote || bulkMoving || bulkDeleteOpen;

  useVimNav({ back: "/", enabled: !hasDialog });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasDialog) return;
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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasDialog, selectedIds]);

  // Scope to the active segments first; "All" (empty set) keeps every note. A
  // note's deck falls back to the viewed deck if cardsInfo hasn't loaded its
  // mapping yet.
  const segmentNotes =
    activeSegments.size === 0
      ? notes
      : notes.filter((note) => activeSegments.has(decks[note.noteId] ?? deckName));

  const trimmedQuery = query.trim().toLowerCase();
  const filteredNotes = trimmedQuery
    ? segmentNotes.filter((note) => {
        const haystack = [
          note.fields.Front?.value,
          note.fields.Back?.value,
          note.fields.Text?.value,
          note.fields["Back Extra"]?.value,
        ]
          .filter(Boolean)
          .map((v) => stripCloze(stripHtml(v as string)))
          .concat(note.tags)
          .join(" ")
          .toLowerCase();
        return haystack.includes(trimmedQuery);
      })
    : segmentNotes;

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
      window.location.reload();
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
      window.location.reload();
    } catch {
      setBulkDeleteOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  }

  // How many notes live directly in each (sub)deck, for the segment badges.
  const countByDeck = new Map<string, number>();
  for (const note of notes) {
    const deck = decks[note.noteId] ?? deckName;
    countByDeck.set(deck, (countByDeck.get(deck) ?? 0) + 1);
  }

  // When the selected segment(s) hold no cards, hide the search field, count,
  // and "no match" message and show a dedicated empty state instead.
  const segmentScopeEmpty = activeSegments.size > 0 && segmentNotes.length === 0;
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
    badge.textContent = ids.length === 1 ? "1 card" : `${ids.length} cards`;
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
        // A horizontal segmented control: one chip per (sub)deck plus "All".
        // Tap to scope the list to a single deck; drag cards onto a chip to move
        // them there. Scrolls sideways when the decks overflow the row.
        <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          <button
            onClick={() => {
              setActiveSegments(new Set());
              setLastSegment(null);
            }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
              activeSegments.size === 0
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/15 hover:bg-foreground/5"
            }`}
          >
            All
            <span className="ml-1.5 opacity-50 tabular-nums">{notes.length}</span>
          </button>
          {segmentDecks.map((d) => {
            const active = activeSegments.has(d);
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
                    : "border-foreground/15 hover:bg-foreground/5"
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

      {!segmentScopeEmpty && (
        <div className="mb-4 flex items-center gap-3">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) {
                  setQuery("");
                } else {
                  searchRef.current?.blur();
                }
              }
            }}
            // Cards being dragged onto a segment carry their note ids as
            // text/plain; block dropping that onto the search box.
            onDrop={(e) => e.preventDefault()}
            placeholder="Search cards…"
            className="flex-1 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30"
          />
        </div>
      )}

      {!segmentScopeEmpty && (
      <div className="mb-4 flex h-9 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {selectionActive ? (
            <>
              <p className="text-sm font-medium">
                {selectedNotes.length}{" "}
                {selectedNotes.length === 1 ? "card" : "cards"} selected
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
              {trimmedQuery
                ? `${filteredNotes.length} of ${segmentNotes.length} ${segmentNotes.length === 1 ? "card" : "cards"}`
                : `${segmentNotes.length} ${segmentNotes.length === 1 ? "card" : "cards"}`}
            </p>
          )}
        </div>
        {selectionActive && (
          <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkSuspend(!allSelectedSuspended)}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
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
              </button>
              <button
                onClick={() => setBulkMoving(true)}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                <FolderSimple size={16} weight="bold" />
                Move
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
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <FolderSimple size={32} weight="light" className="text-foreground/25" />
          <p className="text-sm font-medium text-foreground/70">
            No cards in {emptySegmentLabel}
          </p>
          <p className="text-sm text-foreground/40">
            Drag cards from another deck onto it to move them here.
          </p>
        </div>
      ) : notes.length === 0 ? (
        <p className="text-foreground/50">
          No cards yet. Add your first card above.
        </p>
      ) : filteredNotes.length === 0 ? (
        <p className="text-foreground/50">No cards match &ldquo;{query}&rdquo;.</p>
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
                    : "border-foreground/10 hover:bg-foreground/[0.02]"
                } ${noteSuspended && !selected ? "bg-foreground/[0.03]" : ""}`}
              >
                <button
                  onClick={(e) => handleCheckboxClick(e, note)}
                  aria-label={selected ? "Deselect card" : "Select card"}
                  aria-pressed={selected}
                  className="relative z-10 -m-2 flex shrink-0 items-center justify-center p-2"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/25 text-transparent group-hover:border-foreground/50"
                    }`}
                  >
                    <Check size={13} weight="bold" />
                  </span>
                </button>
                <div className={`flex-1 min-w-0 ${noteSuspended ? "opacity-50" : ""}`}>
                  {isClozeNote(note) ? (
                    <>
                      <p className="text-sm font-medium">
                        {truncate(stripCloze(stripHtml(note.fields.Text?.value ?? "")), 80)}
                      </p>
                      {note.fields["Back Extra"]?.value && (
                        <p className="text-sm text-foreground/50 mt-0.5">
                          {truncate(stripHtml(note.fields["Back Extra"].value), 80)}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        {truncate(stripHtml(note.fields.Front?.value ?? ""), 80)}
                      </p>
                      <p className="text-sm text-foreground/50 mt-0.5">
                        {truncate(stripHtml(note.fields.Back?.value ?? ""), 80)}
                      </p>
                    </>
                  )}
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
        <CardForm deckName={deckName} onClose={() => onShowAddForm(false)} />
      )}

      {editingNote && (
        <CardForm
          deckName={deckName}
          note={editingNote}
          onClose={() => setEditingNote(null)}
        />
      )}

      {movingNote && (
        <MoveCardDialog
          notes={[movingNote]}
          currentDeck={deckName}
          onClose={() => setMovingNote(null)}
        />
      )}

      {bulkMoving && (
        <MoveCardDialog
          notes={selectedNotes}
          currentDeck={deckName}
          onClose={() => setBulkMoving(false)}
        />
      )}

      {bulkDeleteOpen && (
        <ConfirmDialog
          title={
            selectedNotes.length === 1 ? "Delete Card" : "Delete Cards"
          }
          message={
            selectedNotes.length === 1
              ? "Delete the selected card?"
              : `Delete ${selectedNotes.length} selected cards?`
          }
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
          loading={bulkDeleting}
        />
      )}

      {deletingNote && (
        <ConfirmDialog
          title="Delete Card"
          message={`Delete "${truncate(
            isClozeNote(deletingNote)
              ? stripCloze(stripHtml(deletingNote.fields.Text?.value ?? ""))
              : stripHtml(deletingNote.fields.Front?.value ?? ""),
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
