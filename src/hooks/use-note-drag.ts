// Drag-and-drop for note rows onto the segment chips: the drag payload (one
// note, or the whole selection), the hand-built count-badge drag preview, and
// the drop-target highlight.

import {
  useCallback,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import type { Note } from "@/lib/types";
import { createDragBadge } from "@/lib/drag-badge";

interface UseNoteDragOptions {
  /** Every note in the deck, for resolving the dragged ids on drop. */
  notes: Note[];
  /** The current selection, read at drag start (keeps the handler stable). */
  getSelectedIds: () => Set<number>;
  /** Perform the move — bulk-actions' handleMoveToDeck. */
  moveToDeck: (notes: Note[], target: string) => Promise<void>;
}

export function useNoteDrag({
  notes,
  getSelectedIds,
  moveToDeck,
}: UseNoteDragOptions) {
  // The deck a card is currently being dragged over, for drop-target highlight.
  const [dragOverDeck, setDragOverDeck] = useState<string | null>(null);
  // The note ids in the active drag (one card, or the whole selection).
  const draggingRef = useRef<number[]>([]);
  // The off-screen element used as the drag preview, torn down on drag end.
  const dragImageRef = useRef<HTMLElement | null>(null);

  const handleRowDragStart = useCallback(
    (e: ReactDragEvent, note: Note) => {
      // Drag the whole selection when the grabbed card is part of it; otherwise
      // just the one card.
      const selected = getSelectedIds();
      const ids = selected.has(note.noteId)
        ? Array.from(selected)
        : [note.noteId];
      draggingRef.current = ids;
      // "copyMove" so the drop targets can show a "copy" (+) cursor — on macOS the
      // plain "move" cursor is indistinguishable from the default arrow, making
      // the segments look like they don't accept the drop.
      e.dataTransfer.effectAllowed = "copyMove";
      // Firefox requires data to be set for the drag to start at all.
      e.dataTransfer.setData("text/plain", ids.join(","));

      // Replace the default (semi-transparent row) preview with a solid count
      // badge, kept off-screen in the DOM until drag end clears it.
      const wrapper = createDragBadge(ids.length);
      document.body.appendChild(wrapper);
      dragImageRef.current = wrapper;
      e.dataTransfer.setDragImage(wrapper, 0, 0);
    },
    [getSelectedIds],
  );

  const handleRowDragEnd = useCallback(() => {
    draggingRef.current = [];
    setDragOverDeck(null);
    // Tear down the off-screen drag preview.
    dragImageRef.current?.remove();
    dragImageRef.current = null;
  }, [setDragOverDeck]);

  function handleSegmentDrop(target: string) {
    const ids = draggingRef.current;
    draggingRef.current = [];
    setDragOverDeck(null);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    void moveToDeck(
      notes.filter((n) => idSet.has(n.noteId)),
      target,
    );
  }

  function handleSegmentDragLeave(deck: string) {
    setDragOverDeck((prev) => (prev === deck ? null : prev));
  }

  return {
    dragOverDeck,
    setDragOverDeck,
    handleRowDragStart,
    handleRowDragEnd,
    handleSegmentDrop,
    handleSegmentDragLeave,
  };
}
