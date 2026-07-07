// Sequential edit run: the note editor opens one selected note at a time, and
// "Update Note" (or Skip) advances. The cursor logic lives in lib/edit-sequence
// so it can be tested without rendering the editor; this owns the run's state
// plus the delete-current-note confirmation.

import { useCallback, useState } from "react";
import type { Note } from "@/lib/types";
import {
  createEditSequence,
  editSequenceCurrentId,
  editSequenceDeleted,
  type EditSequence,
  type SequenceStep,
} from "@/lib/edit-sequence";
import { deleteNotes } from "@/lib/notes";
import { failureMessage } from "@/lib/failure-message";
import { useToast } from "@/lib/toast-context";

export function useEditSequenceRun(
  refreshAfterChange: (updatedNote?: Note) => void,
) {
  const toast = useToast();
  const [editSeq, setEditSeq] = useState<EditSequence | null>(null);
  // Confirmation for deleting the card currently open in the edit run.
  const [seqDeleteOpen, setSeqDeleteOpen] = useState(false);
  const [seqDeleting, setSeqDeleting] = useState(false);

  const beginEdit = useCallback((ids: number[]) => {
    setEditSeq(createEditSequence(ids));
  }, []);

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
      await deleteNotes([editSequenceCurrentId(editSeq)]);
      setSeqDeleteOpen(false);
      applyStep(editSequenceDeleted(editSeq));
    } catch (err) {
      setSeqDeleteOpen(false);
      toast.error(
        failureMessage(err, "Couldn't delete the note. Is Anki still running?"),
      );
    } finally {
      setSeqDeleting(false);
    }
  }

  return {
    editSeq,
    setEditSeq,
    seqDeleteOpen,
    setSeqDeleteOpen,
    seqDeleting,
    beginEdit,
    finishEdit,
    applyStep,
    handleSeqDelete,
  };
}
