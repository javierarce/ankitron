// The deck page's note list. The heavy machinery lives in dedicated hooks —
// search/sort (use-note-search), multi-select (use-note-selection), note
// mutations (use-bulk-actions), the tag-undo window (use-tag-undo), and the
// keyboard dispatcher (use-card-list-shortcuts) — plus the memo'd NoteRow and
// the SegmentBar. This component owns the view state that ties them together:
// the deck map, segment scoping, drag-and-drop, the edit-sequence run, and the
// six modals.

import { useState, useRef, useCallback, useMemo } from "react";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
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
import { deckLeaf, isCardInDeck, segmentLabelParts } from "@/lib/deck";
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
import { SegmentBar } from "./card-list-segments";
import { CardListToolbar } from "./card-list-toolbar";

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
  noteFlags,
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
    initialSegments,
    segmentDecks,
    onSegmentsChange,
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
    selectAllVisible,
    allVisibleSelected,
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

  const {
    editSeq,
    setEditSeq,
    seqDeleteOpen,
    setSeqDeleteOpen,
    seqDeleting,
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
    !!editSeq;

  useVimNav({ enabled: !hasDialog });

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
  const emptySegmentLabel = onlySegment
    ? (() => {
        const { prefix, leaf } = segmentLabelParts(onlySegment, deckName);
        return (prefix ?? "") + leaf;
      })()
    : "the selected decks";

  return (
    <div>
      {hasSegments && (
        <SegmentBar
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
          allVisibleSelected={allVisibleSelected}
          onSelectAllVisible={selectAllVisible}
          onClearSelection={clearSelection}
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
        <p className="text-foreground/50">No notes match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="space-y-2">
          {filteredNotes.map((note) => (
            <NoteRow
              key={note.noteId}
              note={note}
              selected={selectedIds.has(note.noteId)}
              suspended={isNoteSuspended(note)}
              flag={noteFlag(note)}
              draggable={hasSegments}
              onOpen={setEditingNote}
              onCheckboxClick={handleCheckboxClick}
              onToggleSuspend={handleToggleSuspend}
              onSetFlag={handleSetFlag}
              onMove={setMovingNote}
              onDelete={setDeletingNote}
              onDragStart={handleRowDragStart}
              onDragEnd={handleRowDragEnd}
            />
          ))}
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
          // The form's deck baseline must be the note's own deck: seeding it
          // with the viewed parent both misreports where a subdeck note lives
          // and turns "move to the parent deck" into a silent no-op (the save
          // compares against the baseline and sees no change).
          deckName={homeDeck(editingNote)}
          note={editingNote}
          onDelete={() => setDeletingNote(editingNote)}
          blocked={!!deletingNote}
          onClose={() => setEditingNote(null)}
          onSaved={(updated, opts) => {
            const editedId = editingNote.noteId;
            setEditingNote(null);
            // A no-op save (paged through, untouched) wrote nothing — skip the
            // refresh entirely. A same-note, same-deck edit can be patched in
            // place by the parent; a move or note-type change (new note id)
            // needs the full refetch to fix list membership and deck badges.
            if (!updated) return;
            const patchable = updated.noteId === editedId && !opts?.movedTo;
            refreshAfterChange(patchable ? updated : undefined);
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
