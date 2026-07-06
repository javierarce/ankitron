// The last bulk tag change, kept briefly so Cmd+Z can reverse it. Auto-expires
// so the undo window is short and predictable rather than reaching back across
// unrelated edits.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/types";
import type { TagChange } from "@/components/bulk-tag-dialog";
import { addTagsToNotes, removeTagsFromNotes } from "@/lib/notes";
import { failureMessage } from "@/lib/failure-message";
import { useToast } from "@/lib/toast-context";

export function useTagUndo(refreshAfterChange: (updatedNote?: Note) => void) {
  const toast = useToast();
  const [tagUndo, setTagUndo] = useState<TagChange | null>(null);
  const tagUndoTimer = useRef<number | null>(null);

  const clearTagUndo = useCallback(() => {
    if (tagUndoTimer.current !== null) {
      window.clearTimeout(tagUndoTimer.current);
      tagUndoTimer.current = null;
    }
    setTagUndo(null);
  }, []);

  const armTagUndo = useCallback((change: TagChange | null) => {
    if (tagUndoTimer.current !== null) window.clearTimeout(tagUndoTimer.current);
    setTagUndo(change);
    tagUndoTimer.current = change
      ? window.setTimeout(() => setTagUndo(null), 10000)
      : null;
  }, []);

  const handleTagUndo = useCallback(async () => {
    const change = tagUndo;
    if (!change) return;
    clearTagUndo();
    try {
      for (const op of change.ops) {
        if (op.action === "addTags") {
          await addTagsToNotes(op.noteIds, [op.tag]);
        } else {
          await removeTagsFromNotes(op.noteIds, [op.tag]);
        }
      }
      refreshAfterChange();
    } catch (err) {
      // A failed undo just stays undone rather than retrying in a loop.
      toast.error(
        failureMessage(err, "Couldn't undo the tag change. Is Anki still running?"),
      );
    }
  }, [tagUndo, clearTagUndo, refreshAfterChange, toast]);

  useEffect(() => () => clearTagUndo(), [clearTagUndo]);

  // Drop the pending undo without touching the timer — state-only, so it's
  // safe to call from the caller's adjust-state-during-render block when
  // navigating to a different deck. (The orphaned timer just re-clears null.)
  const resetTagUndo = useCallback(() => {
    setTagUndo(null);
  }, []);

  return { tagUndo, armTagUndo, handleTagUndo, resetTagUndo };
}
