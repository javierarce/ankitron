// The card list's note mutations: suspend/unsuspend (single, keyboard, and
// bulk), delete (single and bulk), and moving notes between decks — each with
// its failure toast. View state that other features read (the deck map, the
// selection) stays with the caller, patched through callbacks.

import { useCallback, useState } from "react";
import type { Note } from "@/lib/types";
import { setSuspended as setCardsSuspended } from "@/lib/cards";
import { deleteNotes, moveNotesToDeck } from "@/lib/notes";
import { failureMessage } from "@/lib/failure-message";
import { useToast } from "@/lib/toast-context";

interface UseBulkActionsOptions {
  /** Every note in the deck, for resolving keyboard-shortcut targets. */
  notes: Note[];
  selectedNotes: Note[];
  suspendedCardIds?: number[];
  /** A note's current home deck, for skipping already-in-place moves. */
  homeDeck: (note: Note) => string;
  /** Called after cards are suspended or unsuspended, so the parent can refresh due counts. */
  onSuspendChange?: () => void;
  /** After a successful move: patch the moved notes' home decks and selection. */
  onMoved: (moved: Note[], target: string) => void;
  refreshAfterChange: (updatedNote?: Note) => void;
  clearSelection: () => void;
  /** Close the note editor after a single delete — it may have been the delete's entry point. */
  closeEditor: () => void;
}

export function useBulkActions({
  notes,
  selectedNotes,
  suspendedCardIds,
  homeDeck,
  onSuspendChange,
  onMoved,
  refreshAfterChange,
  clearSelection,
  closeEditor,
}: UseBulkActionsOptions) {
  const toast = useToast();
  const [suspended, setSuspended] = useState<Set<number>>(
    () => new Set(suspendedCardIds ?? []),
  );
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const isNoteSuspended = useCallback(
    (note: Note): boolean => (note.cards ?? []).some((id) => suspended.has(id)),
    [suspended],
  );

  const handleToggleSuspend = useCallback(
    async (note: Note) => {
      const cardIds = note.cards ?? [];
      if (cardIds.length === 0) return;
      const isSuspended = isNoteSuspended(note);
      try {
        await setCardsSuspended(cardIds, !isSuspended);
        setSuspended((prev) => {
          const next = new Set(prev);
          for (const id of cardIds) {
            if (isSuspended) next.delete(id);
            else next.add(id);
          }
          return next;
        });
        onSuspendChange?.();
      } catch (err) {
        toast.error(
          failureMessage(
            err,
            isSuspended
              ? "Couldn't unsuspend the note. Is Anki still running?"
              : "Couldn't suspend the note. Is Anki still running?",
          ),
        );
      }
    },
    [isNoteSuspended, onSuspendChange, toast],
  );

  /**
   * The `s` shortcut's suspend: like the row menu, this toggles a note's cards
   * together, so the suspended badge stays accurate. Unsuspend only when every
   * target note is already suspended; otherwise suspend (matches the bulk
   * action). Returns false when the targets have no cards, so the caller can
   * skip preventDefault.
   */
  const suspendNotes = useCallback(
    (noteIds: number[]): boolean => {
      const idSet = new Set(noteIds);
      const targetNotes = notes.filter((n) => idSet.has(n.noteId));
      const cardIds = targetNotes.flatMap((n) => n.cards ?? []);
      if (cardIds.length === 0) return false;
      const allSuspended = targetNotes.every((n) =>
        (n.cards ?? []).some((id) => suspended.has(id)),
      );
      setCardsSuspended(cardIds, !allSuspended)
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
        .catch((err) => {
          toast.error(
            failureMessage(
              err,
              allSuspended
                ? "Couldn't unsuspend the notes. Is Anki still running?"
                : "Couldn't suspend the notes. Is Anki still running?",
            ),
          );
        });
      return true;
    },
    [notes, suspended, onSuspendChange, toast],
  );

  async function handleBulkSuspend(suspend: boolean) {
    const cardIds = selectedNotes.flatMap((n) => n.cards ?? []);
    if (cardIds.length === 0) return;
    try {
      await setCardsSuspended(cardIds, suspend);
      setSuspended((prev) => {
        const next = new Set(prev);
        for (const id of cardIds) {
          if (suspend) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      onSuspendChange?.();
    } catch (err) {
      toast.error(
        failureMessage(
          err,
          suspend
            ? "Couldn't suspend the selected notes. Is Anki still running?"
            : "Couldn't unsuspend the selected notes. Is Anki still running?",
        ),
      );
    }
  }

  async function handleDelete() {
    if (!deletingNote) return;
    setDeleting(true);
    try {
      await deleteNotes([deletingNote.noteId]);
      setDeletingNote(null);
      // Close the editor too — it may have been the delete's entry point.
      closeEditor();
      refreshAfterChange();
    } catch (err) {
      setDeletingNote(null);
      toast.error(
        failureMessage(err, "Couldn't delete the note. Is Anki still running?"),
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedNotes.length === 0) return;
    setBulkDeleting(true);
    try {
      await deleteNotes(selectedNotes.map((n) => n.noteId));
      setBulkDeleteOpen(false);
      clearSelection();
      refreshAfterChange();
    } catch (err) {
      setBulkDeleteOpen(false);
      toast.error(
        failureMessage(
          err,
          "Couldn't delete the selected notes. Is Anki still running?",
        ),
      );
    } finally {
      setBulkDeleting(false);
    }
  }

  // Move the given notes into a target (sub)deck; the caller's onMoved patches
  // its view state so the list updates in place rather than reloading. Notes
  // already in the target are skipped.
  const handleMoveToDeck = useCallback(
    async (noteList: Note[], target: string) => {
      const toMove = noteList.filter((n) => homeDeck(n) !== target);
      if (toMove.length === 0) return;
      try {
        await moveNotesToDeck(toMove, target);
        onMoved(toMove, target);
      } catch (err) {
        // Leave the list untouched if the move fails — just say so.
        toast.error(
          failureMessage(
            err,
            toMove.length === 1
              ? "Couldn't move the note. Is Anki still running?"
              : "Couldn't move the notes. Is Anki still running?",
          ),
        );
      }
    },
    [homeDeck, onMoved, toast],
  );

  return {
    isNoteSuspended,
    handleToggleSuspend,
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
  };
}
