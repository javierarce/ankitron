// The deck page's note list. The heavy machinery lives in dedicated hooks —
// search/sort (use-note-search), multi-select (use-note-selection), note
// mutations (use-bulk-actions), the tag-undo window (use-tag-undo), and the
// keyboard dispatcher (use-card-list-shortcuts) — plus the memo'd NoteRow and
// the SubdeckTree. This component owns the view state that ties them together:
// the deck map, segment scoping, drag-and-drop, the edit-sequence run, and the
// six modals.

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
import { NoteStatsDialog } from "./note-stats-dialog";
import { SearchInput } from "./search-input";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveCardDialog } from "./move-card-dialog";
import { BulkTagDialog } from "./bulk-tag-dialog";
import {
  editSequencePrev,
  editSequenceNext,
  editSequenceSaved,
  editSequenceCurrentId,
  editSequenceCurrentNote,
} from "@/lib/edit-sequence";
import { stripCloze } from "@/lib/cloze";
import { stripHtml, truncate } from "@/lib/html-text";
import { noteDisplayFields } from "@/lib/note-fields";
import { deckLeaf, isCardInDeck, type DeckRename } from "@/lib/deck";
import { createDeck } from "@/lib/decks";
import { searchTerms } from "@/lib/search-query";
import {
  countLeeches,
  isLeech,
  isLeechQuery,
  LEECH_QUERY,
} from "@/lib/leeches";
import { useVimNav } from "@/hooks/use-vim-nav";
import { useDeckSegments } from "@/hooks/use-deck-segments";
import { useNoteDrag } from "@/hooks/use-note-drag";
import { useNoteSearch } from "@/hooks/use-note-search";
import { useNoteSelection } from "@/hooks/use-note-selection";
import { useBulkActions } from "@/hooks/use-bulk-actions";
import { useTagUndo } from "@/hooks/use-tag-undo";
import { useEditSequenceRun } from "@/hooks/use-edit-sequence-run";
import { useCardListShortcuts } from "@/hooks/use-card-list-shortcuts";
import { NoteRow } from "./card-list-note-row";
import { SubdeckTree } from "./subdeck-tree";
import { CardListToolbar } from "./card-list-toolbar";
import { LeechBanner } from "./leech-banner";

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

interface CardListProps {
  deckName: string;
  notes: Note[];
  suspendedCardIds?: number[];
  /** Each note's current flag (0 = none), keyed by note id. */
  noteFlags?: Record<number, number>;
  /** Each note's home deck. Lets the list scope to one subdeck via the segments. */
  noteDecks?: Record<number, string>;
  /** Decks nested under this one, sorted as a tree. Drives the segmented control. */
  subdecks?: string[];
  /**
   * The most recent deck rename's from→to mapping. When a scoped subdeck is
   * renamed in place, this carries the active segment selection over to the new
   * name instead of dropping it (the subdeck's chip just changed identity).
   */
  scopeRenames?: DeckRename[] | null;
  /** Called after cards are suspended or unsuspended, so the parent can refresh due counts. */
  onSuspendChange?: () => void;
  /** Called after cards are moved between (sub)decks, so the parent can refresh due counts. */
  onCardsMoved?: () => void;
  /**
   * Called after a card is added, edited, or deleted so the parent can refetch
   * the list in place. Without it these actions fall back to a full page
   * reload, which blanks the whole app. A same-deck single-note edit passes
   * the updated note so the parent can patch it into its list instead of
   * refetching the whole deck; no argument means "refetch everything".
   */
  onChanged?: (updatedNote?: Note) => void;
  /** Add-card form visibility, owned by the page so the button can live in its header. */
  showAddForm: boolean;
  onShowAddForm: (show: boolean) => void;
  /**
   * Reports the single subdeck the list is currently scoped to (null when
   * scoped to "All" or to several subdecks at once). Lets the page header
   * retarget its title and its Settings/Add note/Study actions to that subdeck.
   */
  onScopeChange?: (deck: string | null) => void;
  /**
   * A note to open for editing as soon as the list has it — how another page
   * links to a specific card rather than to the deck it lives in (the Stats
   * page's trouble spots). Ignored when the note isn't in this deck, which is
   * what a link built from stale cached stats points at.
   */
  openNoteId?: number | null;
}

export function CardList({
  deckName,
  notes,
  suspendedCardIds,
  noteFlags,
  noteDecks,
  subdecks,
  scopeRenames,
  onSuspendChange,
  onCardsMoved,
  onChanged,
  showAddForm,
  onShowAddForm,
  onScopeChange,
  openNoteId,
}: CardListProps) {
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Open the note another page asked for, once we have it (adjusting state
  // during render rather than in an effect, as elsewhere in this file). The
  // request is remembered as handled so the editor opens exactly once: the
  // request outlives the open, and every later `notes` array — the post-save
  // refresh, a drag, a delete — would otherwise reopen what the user closed.
  // An id we never find (a deck it doesn't live in, a note deleted since the
  // stats were cached) just leaves the deck as it is.
  const [handledOpenId, setHandledOpenId] = useState<number | null>(null);
  if (openNoteId != null && openNoteId !== handledOpenId) {
    const note = notes.find((n) => n.noteId === openNoteId);
    if (note) {
      setHandledOpenId(openNoteId);
      setEditingNote(note);
    }
  }
  // The notes whose stats dialog is open (ids, so the row's onStats handler
  // stays identity-stable for the memo'd rows) plus the page within them. A
  // row opens just its note; the `i` shortcut opens the whole selection so you
  // can page through it — mirroring Edit.
  const [statsIds, setStatsIds] = useState<number[] | null>(null);
  const [statsIndex, setStatsIndex] = useState(0);
  const openStats = useCallback((note: Note) => {
    setStatsIds([note.noteId]);
    setStatsIndex(0);
  }, []);
  const openStatsForIds = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setStatsIds(ids);
    setStatsIndex(0);
  }, []);
  const [movingNote, setMovingNote] = useState<Note | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTagging, setBulkTagging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Refresh the list in place after a write. Falls back to a full page reload
  // only if the parent didn't wire up an in-place refresh.
  const refreshAfterChange = useMemo<(updatedNote?: Note) => void>(
    () => onChanged ?? (() => window.location.reload()),
    [onChanged],
  );

  const { tagUndo, armTagUndo, handleTagUndo, resetTagUndo } =
    useTagUndo(refreshAfterChange);

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

  // One chip per subdeck. The root deck isn't a chip: studying it would pull in
  // every subdeck anyway (Anki reviews a deck's whole subtree), so scoping to it
  // is exactly what "All" does — a separate root chip just sets a count that the
  // study session can't honour.
  const hasSegments = (subdecks?.length ?? 0) > 0;
  const segmentDecks = subdecks ?? [];

  const { activeSegments, handleSegmentClick, clearSegments } = useDeckSegments({
    segmentDecks,
    renames: scopeRenames,
  });

  // Reset back to "All" whenever we navigate to a different deck.
  const [prevDeckName, setPrevDeckName] = useState(deckName);
  if (deckName !== prevDeckName) {
    setPrevDeckName(deckName);
    clearSegments();
    resetTagUndo();
  }

  const homeDeck = useCallback(
    (note: Note) => decks[note.noteId] ?? deckName,
    [decks, deckName],
  );

  // Scope to the active segments first; "All" (empty set) keeps every note. A
  // segment covers its whole subtree, so a chip for a parent deck (e.g.
  // "Deutsch") includes every note under it — matching the count on the chip
  // and what a study session for it would review. A note's deck falls back to
  // the viewed deck if getDecks hasn't loaded its mapping yet.
  const segmentNotes = useMemo(() => {
    if (activeSegments.size === 0) return notes;
    const activeSegmentList = [...activeSegments];
    return notes.filter((note) => {
      const home = decks[note.noteId] ?? deckName;
      return activeSegmentList.some((seg) => isCardInDeck(home, seg));
    });
  }, [notes, activeSegments, decks, deckName]);

  const {
    query,
    setQuery,
    setContextQ,
    effective,
    sortMode,
    handleSortChange,
    filteredNotes,
    searchSources,
  } = useNoteSearch({ deckName, segmentNotes, homeDeck });

  // The literal text the query is looking for, for the rows to highlight.
  // Memoized against the query so every row gets an identity-stable prop and
  // the memo'd NoteRow keeps ignoring renders the search didn't cause.
  const highlightTerms = useMemo(() => searchTerms(effective), [effective]);

  const {
    selectedIds,
    toggleSelected,
    handleCheckboxClick,
    clearSelection,
    deselectAll,
    replaceSelection,
    addToSelection,
    removeFromSelection,
    setAnchor,
    getSelectedIds,
    targetNoteIds,
  } = useNoteSelection(filteredNotes);

  const selectedNotes = useMemo(
    () => notes.filter((n) => selectedIds.has(n.noteId)),
    [notes, selectedIds],
  );

  // After a successful move: patch the moved notes' home decks so the list
  // updates in place, and drop them from the selection — they've left the
  // current view.
  const handleNotesMoved = useCallback(
    (moved: Note[], target: string) => {
      setDecks((prev) => {
        const next = { ...prev };
        for (const n of moved) next[n.noteId] = target;
        return next;
      });
      removeFromSelection(moved.map((n) => n.noteId));
      onCardsMoved?.();
    },
    [removeFromSelection, onCardsMoved],
  );

  const closeEditor = useCallback(() => setEditingNote(null), []);

  const {
    isNoteSuspended,
    handleToggleSuspend,
    noteFlag,
    handleSetFlag,
    flagNotes,
    handleBulkFlag,
    suspendNotes,
    handleBulkSuspend,
    deletingNote,
    setDeletingNote,
    deleting,
    handleDelete,
    bulkDeleteOpen,
    setBulkDeleteOpen,
    bulkDeleting,
    handleBulkDelete,
    forgettingNotes,
    setForgettingNotes,
    forgetting,
    handleForget,
    forgetNotesNow,
    deleteNoteNow,
    handleMoveToDeck,
  } = useBulkActions({
    notes,
    selectedNotes,
    suspendedCardIds,
    noteFlags,
    homeDeck,
    onSuspendChange,
    onMoved: handleNotesMoved,
    refreshAfterChange,
    clearSelection,
    closeEditor,
  });

  // The editor's "Move to deck…" — it picks a deck (possibly a new one) and
  // applies it straight away, so the deck has to exist before the move.
  const moveNoteNow = useCallback(
    async (target: Note, deck: string, isNew: boolean) => {
      if (isNew) await createDeck(deck);
      await handleMoveToDeck([target], deck);
    },
    [handleMoveToDeck],
  );

  // Identity-stable so the memo'd rows don't re-render on every list change.
  const handleRowForget = useCallback(
    (note: Note) => setForgettingNotes([note]),
    [setForgettingNotes],
  );

  // The deck's leeches. Free to compute — the notes carry their tags already —
  // and isNoteSuspended is the live set, so unsuspending one updates the count
  // in place. Counted over the whole deck rather than the active segments: it's
  // a deck-level notice (the acknowledgement below is stored per deck), and
  // clicking through clears the segments so the list shows exactly the notes
  // the banner named.
  const leechCount = useMemo(
    () => countLeeches(notes, isNoteSuspended),
    [notes, isNoteSuspended],
  );
  // Stands until the leeches are dealt with and their tags cleared — there's
  // nothing to remember, and no dismiss. It does stand down while the list is
  // already filtered to them, where it would only describe what's on screen.
  const showLeechBanner = leechCount.total > 0 && !isLeechQuery(effective);

  // Filter the list to the leeches AND select them, which is the whole handoff:
  // the bulk bar appears holding every action worth taking on a leech, and Edit
  // there is the one-at-a-time walkthrough the references recommend. Selecting
  // is also the only way to reach "all of them" — select-all is Cmd+A with no
  // button (see CardListToolbar), so a banner that merely filtered would leave
  // the useful part undiscoverable.
  //
  // Deliberately does NOT focus the search box: the shortcut handler ignores
  // keys typed in a field, so focusing it would make Escape stop clearing the
  // selection we just made.
  const handleShowLeeches = useCallback(() => {
    // Back to "All" first: the count is deck-wide, so a subdeck still in scope
    // would answer the click with fewer notes than the banner just promised.
    clearSegments();
    setQuery(LEECH_QUERY);
    // Safe before the debounced `tag:leech` query lands: the selection isn't
    // pruned against the filtered list, and the bulk actions read the deck's
    // full note array rather than the filtered one.
    replaceSelection(notes.filter(isLeech).map((n) => n.noteId));
  }, [clearSegments, setQuery, replaceSelection, notes]);

  const {
    editSeq,
    setEditSeq,
    beginEdit,
    finishEdit,
    applyStep,
    handleSeqDelete,
  } = useEditSequenceRun(refreshAfterChange);

  const {
    dragOverDeck,
    setDragOverDeck,
    handleRowDragStart,
    handleRowDragEnd,
    handleSegmentDrop,
    handleSegmentDragLeave,
  } = useNoteDrag({ notes, getSelectedIds, moveToDeck: handleMoveToDeck });

  const hasDialog =
    showAddForm ||
    !!editingNote ||
    !!deletingNote ||
    !!movingNote ||
    bulkMoving ||
    bulkTagging ||
    bulkDeleteOpen ||
    forgettingNotes !== null ||
    statsIds !== null ||
    !!editSeq;

  useVimNav({ enabled: !hasDialog });

  // Clicking anywhere off the cards clears the selection (like Esc). Note rows,
  // the bulk toolbar and its portalled menus, open dialogs, the subdeck tree,
  // and any interactive control are excluded — only "empty" clicks deselect.
  useEffect(() => {
    if (selectedIds.size === 0 || hasDialog) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "[data-note-id],[data-bulk-toolbar],[data-subdeck-tree],[role='menu'],[role='dialog'],button,a,input,select,textarea,label",
        )
      ) {
        return;
      }
      deselectAll();
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [selectedIds, hasDialog, deselectAll]);

  const onAddNote = useCallback(() => onShowAddForm(true), [onShowAddForm]);
  const onTagNotes = useCallback(
    (ids: number[]) => {
      replaceSelection(ids);
      setBulkTagging(true);
    },
    [replaceSelection],
  );
  const onMoveNotes = useCallback(
    (ids: number[]) => {
      replaceSelection(ids);
      setBulkMoving(true);
    },
    [replaceSelection],
  );

  useCardListShortcuts({
    enabled: !hasDialog,
    searchRef,
    canUndoTags: !!tagUndo,
    onTagUndo: handleTagUndo,
    hasSelection: selectedIds.size > 0,
    deselectAll,
    replaceSelection,
    addToSelection,
    toggleSelected,
    setAnchor,
    targetNoteIds,
    onAddNote,
    onEditNotes: beginEdit,
    onStatsNotes: openStatsForIds,
    onTagNotes,
    onMoveNotes,
    onSuspendNotes: suspendNotes,
    onFlagNotes: flagNotes,
  });

  const selectionActive = selectedNotes.length > 0;
  const allSelectedSuspended =
    selectionActive && selectedNotes.every((n) => isNoteSuspended(n));

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
  // Just the leaf, not the whole "::" path — a deeply nested subdeck's full path
  // makes the heading unwieldy, and the subdeck tree already shows the context.
  const emptySegmentLabel = onlySegment
    ? deckLeaf(onlySegment)
    : "the selected decks";

  // Surface the scoped subdeck to the page header, so its title and actions can
  // follow the selection. Only a lone selection names a deck; "All" or a
  // multi-select reports null and the header falls back to the opened deck.
  useEffect(() => {
    onScopeChange?.(onlySegment);
  }, [onlySegment, onScopeChange]);

  return (
    <div>
      <div className={hasSegments ? "flex items-start gap-6" : undefined}>
        {hasSegments && (
          <SubdeckTree
            deckName={deckName}
            totalCount={notes.length}
            segmentDecks={segmentDecks}
            activeSegments={activeSegments}
            countByDeck={countByDeck}
            dragOverDeck={dragOverDeck}
            onAllClick={clearSegments}
            onSegmentClick={handleSegmentClick}
            onDragOverDeck={setDragOverDeck}
            onDragLeaveDeck={handleSegmentDragLeave}
            onDropOnDeck={handleSegmentDrop}
          />
        )}

        <div className="min-w-0 flex-1">
          {/* Above the search box rather than down by the rows: it's about the
              deck, not about the current result set. */}
          {showLeechBanner && (
            <LeechBanner count={leechCount} onShow={handleShowLeeches} />
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
            <CardListToolbar
              selectedCount={selectedNotes.length}
              searching={effective !== ""}
              filteredCount={filteredNotes.length}
              scopedCount={segmentNotes.length}
              sortMode={sortMode}
              onSortChange={handleSortChange}
              allSelectedSuspended={allSelectedSuspended}
              onEditSelection={() =>
                beginEdit(
                  filteredNotes
                    .filter((n) => selectedIds.has(n.noteId))
                    .map((n) => n.noteId),
                )
              }
              onBulkSuspend={handleBulkSuspend}
              onBulkFlag={handleBulkFlag}
              onBulkMove={() => setBulkMoving(true)}
              onBulkTag={() => setBulkTagging(true)}
              onBulkForget={() => setForgettingNotes(selectedNotes)}
              onBulkDelete={() => setBulkDeleteOpen(true)}
            />
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
            <p className="text-foreground/50">
              No notes match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredNotes.map((note) => (
                <NoteRow
                  key={note.noteId}
                  note={note}
                  selected={selectedIds.has(note.noteId)}
                  suspended={isNoteSuspended(note)}
                  terms={highlightTerms}
                  flag={noteFlag(note)}
                  draggable={hasSegments}
                  onOpen={setEditingNote}
                  onStats={openStats}
                  onCheckboxClick={handleCheckboxClick}
                  onToggleSuspend={handleToggleSuspend}
                  onSetFlag={handleSetFlag}
                  onMove={setMovingNote}
                  onForget={handleRowForget}
                  onDelete={setDeletingNote}
                  onDragStart={handleRowDragStart}
                  onDragEnd={handleRowDragEnd}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddForm && (
        <CardForm
          // Default a new note to the scoped subdeck when one is selected, so
          // "Add note" files where the header says it will; otherwise the
          // opened deck.
          deckName={onlySegment ?? deckName}
          onClose={() => onShowAddForm(false)}
          onSaved={() => {
            onShowAddForm(false);
            refreshAfterChange();
          }}
        />
      )}

      {editingNote && (
        <CardForm
          // The form's deck baseline must be the note's own deck: seeding it
          // with the viewed parent both misreports where a subdeck note lives
          // and turns "move to the parent deck" into a silent no-op (the save
          // compares against the baseline and sees no change).
          deckName={homeDeck(editingNote)}
          note={editingNote}
          suspended={isNoteSuspended(editingNote)}
          onToggleSuspend={() => handleToggleSuspend(editingNote)}
          // Both act straight away: the form runs its own inline confirmation
          // rather than stacking a dialog over itself.
          onForget={() => forgetNotesNow([editingNote])}
          onMove={(deck, isNew) => moveNoteNow(editingNote, deck, isNew)}
          onDelete={() => deleteNoteNow(editingNote)}
          onClose={() => setEditingNote(null)}
          onSaved={(updated) => {
            const editedId = editingNote.noteId;
            setEditingNote(null);
            // A no-op save (paged through, untouched) wrote nothing — skip the
            // refresh entirely. A same-note edit can be patched in place; a
            // note-type change mints a new note id and needs the full refetch
            // to fix list membership.
            if (!updated) return;
            refreshAfterChange(
              updated.noteId === editedId ? updated : undefined,
            );
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
              deckName={homeDeck(note)}
              note={note}
              position={{ index: editSeq.index, total: editSeq.ids.length }}
              onPrev={() => setEditSeq(editSequencePrev(editSeq))}
              onSkip={() => applyStep(editSequenceNext(editSeq))}
              suspended={isNoteSuspended(note)}
              onToggleSuspend={() => handleToggleSuspend(note)}
              onForget={() => forgetNotesNow([note])}
              onMove={(deck, isNew) => moveNoteNow(note, deck, isNew)}
              onDelete={handleSeqDelete}
              onSaved={(updated) => applyStep(editSequenceSaved(editSeq, updated))}
              onClose={() => finishEdit(editSeq.dirty)}
            />
          );
        })()}

      {statsIds !== null &&
        (() => {
          // The notes to page through: a single note when opened from a row,
          // the whole selection when opened with `i`. Drop any that vanished
          // (edited away) and clamp the page so it stays in range.
          const statsNotes = statsIds
            .map((id) => notes.find((n) => n.noteId === id))
            .filter((n): n is Note => !!n);
          if (statsNotes.length === 0) return null;
          const index = Math.min(statsIndex, statsNotes.length - 1);
          return (
            <NoteStatsDialog
              notes={statsNotes}
              index={index}
              onIndexChange={setStatsIndex}
              onClose={() => setStatsIds(null)}
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

      {forgettingNotes && (
        <ConfirmDialog
          title={forgettingNotes.length === 1 ? "Forget Note" : "Forget Notes"}
          message={
            (forgettingNotes.length === 1
              ? "Reset this note's cards to new? "
              : `Reset ${forgettingNotes.length} notes' cards to new? `) +
            "They lose their interval and ease and come back as unseen cards — " +
            "use this after rewriting a note so the new version starts fresh. " +
            "Suspended cards return to study."
          }
          confirmLabel="Forget"
          onConfirm={handleForget}
          onCancel={() => setForgettingNotes(null)}
          loading={forgetting}
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
