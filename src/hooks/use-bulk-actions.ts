// The card list's note mutations: suspend/unsuspend (single, keyboard, and
// bulk), delete (single and bulk), and moving notes between decks — each with
// its failure toast. View state that other features read (the deck map, the
// selection) stays with the caller, patched through callbacks.

import { useCallback, useState } from "react";
import type { Note } from "@/lib/types";
import {
  forgetCards,
  setSuspended as setCardsSuspended,
} from "@/lib/cards";
import { setNoteFlag } from "@/lib/flags";
import { deleteNotes, moveNotesToDeck } from "@/lib/notes";
import { failureMessage } from "@/lib/failure-message";
import { useToast } from "@/lib/toast-context";

interface UseBulkActionsOptions {
  /** Every note in the deck, for resolving keyboard-shortcut targets. */
  notes: Note[];
  selectedNotes: Note[];
  suspendedCardIds?: number[];
  /** Each note's current flag (0 = none), keyed by note id. */
  noteFlags?: Record<number, number>;
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
  noteFlags,
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
  // Flags kept locally so a change updates the row in place. Seeded from the
  // prop on mount and maintained by the optimistic writes below — mirroring how
  // `suspended` above is owned here rather than driven by the prop each render.
  const [flags, setFlags] = useState<Record<number, number>>(
    () => noteFlags ?? {},
  );
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // The notes a pending Forget would reset (null = no confirmation open). Held
  // as notes rather than a boolean because Forget runs from both the row menu
  // and the selection, and the dialog names how many it's about to affect.
  const [forgettingNotes, setForgettingNotes] = useState<Note[] | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const isNoteSuspended = useCallback(
    (note: Note): boolean => (note.cards ?? []).some((id) => suspended.has(id)),
    [suspended],
  );

  const noteFlag = useCallback(
    (note: Note): number => flags[note.noteId] ?? 0,
    [flags],
  );

  // Set (or clear, with 0) a note's flag — applied to all its cards, like
  // suspension, so a multi-card note flags as a unit. Optimistic: the row
  // updates at once and reverts on failure.
  const handleSetFlag = useCallback(
    async (note: Note, flag: number) => {
      const cardIds = note.cards ?? [];
      if (cardIds.length === 0) return;
      const prev = flags[note.noteId] ?? 0;
      if (prev === flag) return;
      setFlags((m) => ({ ...m, [note.noteId]: flag }));
      try {
        await setNoteFlag(cardIds, flag);
      } catch (err) {
        setFlags((m) => ({ ...m, [note.noteId]: prev }));
        toast.error(
          failureMessage(
            err,
            "Couldn't update the flag. Is Anki still running?",
          ),
        );
      }
    },
    [flags, toast],
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

  // Set (or clear, with 0) a flag on the given notes' cards at once.
  // Optimistic, with a whole-set revert on failure. Shared by the toolbar's
  // bulk button and the card list's Cmd+0–7 shortcut, so it takes explicit note
  // ids rather than reading the selection.
  const flagNotes = useCallback(
    (noteIds: number[], flag: number) => {
      const idSet = new Set(noteIds);
      const targetNotes = notes.filter((n) => idSet.has(n.noteId));
      const cardIds = targetNotes.flatMap((n) => n.cards ?? []);
      if (cardIds.length === 0) return;
      const prev = new Map(
        targetNotes.map((n) => [n.noteId, flags[n.noteId] ?? 0]),
      );
      setFlags((m) => {
        const next = { ...m };
        for (const n of targetNotes) next[n.noteId] = flag;
        return next;
      });
      setNoteFlag(cardIds, flag).catch((err) => {
        setFlags((m) => {
          const next = { ...m };
          for (const [id, f] of prev) next[id] = f;
          return next;
        });
        toast.error(
          failureMessage(
            err,
            "Couldn't flag the notes. Is Anki still running?",
          ),
        );
      });
    },
    [notes, flags, toast],
  );

  // The selection toolbar's "Flag" button acts on the current selection.
  const handleBulkFlag = useCallback(
    (flag: number) => flagNotes(selectedNotes.map((n) => n.noteId), flag),
    [flagNotes, selectedNotes],
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

  /**
   * Reset every card of these notes back to new, no questions asked — the
   * caller has already confirmed however it sees fit (the list uses a dialog,
   * the editor asks inline in its own footer).
   *
   * Anki's reset also clears suspension, so the local suspended set is pruned
   * and the parent asked to refresh its due counts: a forgotten card is back in
   * rotation and the deck's New count just went up.
   *
   * Reports whether the reset actually landed. Failures are toasted here rather
   * than thrown, so without a return value a caller can't tell — and the editor
   * would announce "Scheduling reset" over the top of an error toast.
   */
  const forgetNotesNow = useCallback(
    async (targets: Note[]): Promise<boolean> => {
      const cardIds = targets.flatMap((n) => n.cards ?? []);
      if (cardIds.length === 0) return false;
      try {
        await forgetCards(cardIds);
        setSuspended((prev) => {
          const next = new Set(prev);
          for (const id of cardIds) next.delete(id);
          return next;
        });
        onSuspendChange?.();
        // The rows themselves don't change, but their scheduling did — refetch
        // so anything reading card state (the suspended badge, the note's
        // statistics) is honest.
        refreshAfterChange();
        return true;
      } catch (err) {
        toast.error(
          failureMessage(
            err,
            targets.length === 1
              ? "Couldn't reset the note. Is Anki still running?"
              : "Couldn't reset the selected notes. Is Anki still running?",
          ),
        );
        return false;
      }
    },
    [onSuspendChange, refreshAfterChange, toast],
  );

  /** Delete one note without the dialog, for the same reason as above. */
  const deleteNoteNow = useCallback(
    async (target: Note) => {
      try {
        await deleteNotes([target.noteId]);
        // The editor may have been the delete's entry point.
        closeEditor();
        refreshAfterChange();
      } catch (err) {
        toast.error(
          failureMessage(err, "Couldn't delete the note. Is Anki still running?"),
        );
      }
    },
    [closeEditor, refreshAfterChange, toast],
  );

  /** The list's dialog-driven Forget, over the selection or one row. */
  async function handleForget() {
    const targets = forgettingNotes;
    if (!targets || targets.length === 0) return;
    setForgetting(true);
    try {
      await forgetNotesNow(targets);
    } finally {
      setForgetting(false);
      setForgettingNotes(null);
    }
  }

  /**
   * Move the given notes into a target (sub)deck; the caller's onMoved patches
   * its view state so the list updates in place rather than reloading. Notes
   * already in the target are skipped.
   *
   * Reports whether the notes are where they were asked to be. Like the reset
   * above, a failure is toasted rather than thrown, so without a return value a
   * caller can't tell — and the editor would react to a move that never
   * happened by closing itself or dropping the note from a sequence run.
   */
  const handleMoveToDeck = useCallback(
    async (noteList: Note[], target: string): Promise<boolean> => {
      const toMove = noteList.filter((n) => homeDeck(n) !== target);
      // Already there: nothing to do, and nothing went wrong.
      if (toMove.length === 0) return true;
      try {
        await moveNotesToDeck(toMove, target);
        onMoved(toMove, target);
        return true;
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
        return false;
      }
    },
    [homeDeck, onMoved, toast],
  );

  return {
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
  };
}
