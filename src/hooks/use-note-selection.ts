// The card list's multi-select state: which notes are selected, the shift-range
// anchor, and the DOM-reading helpers the keyboard dispatcher shares with it.
//
// Every callback here is stable (or changes only with the visible list), so
// they can be passed to a memo'd NoteRow without defeating the memo.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "@/lib/types";

/**
 * Every rendered note row, in display order. Selection ranges and the keyboard
 * dispatcher read the DOM (via the rows' data-note-id) so order and membership
 * stay current without depending on the notes themselves.
 */
export function visibleNoteRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-note-id]"));
}

/** The note row wrapping the currently focused element, if any. */
export function focusedNoteRow(): HTMLElement | null {
  return ((document.activeElement as HTMLElement | null)?.closest?.(
    "[data-note-id]",
  ) ?? null) as HTMLElement | null;
}

export function useNoteSelection(filteredNotes: Note[]) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  // The last note clicked/toggled, used as the anchor for Shift+click ranges.
  const lastSelectedRef = useRef<number | null>(null);

  // Mirror of selectedIds for event-time reads (drag start grabs the whole
  // selection), so those handlers stay identity-stable across selection
  // changes.
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  });

  const toggleSelected = useCallback((noteId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const handleCheckboxClick = useCallback(
    (e: ReactMouseEvent, note: Note) => {
      e.stopPropagation();
      const anchorId = lastSelectedRef.current;
      if (e.shiftKey && anchorId !== null) {
        const anchorIdx = filteredNotes.findIndex((n) => n.noteId === anchorId);
        const clickedIdx = filteredNotes.findIndex(
          (n) => n.noteId === note.noteId,
        );
        if (anchorIdx !== -1 && clickedIdx !== -1) {
          const [start, end] =
            anchorIdx < clickedIdx
              ? [anchorIdx, clickedIdx]
              : [clickedIdx, anchorIdx];
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
    },
    [filteredNotes, toggleSelected],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }, []);

  // Escape's clear: empties the selection but keeps the shift anchor, so a
  // follow-up Shift+click still ranges from the last-touched row.
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const replaceSelection = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const addToSelection = useCallback((ids: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const removeFromSelection = useCallback((ids: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const setAnchor = useCallback((noteId: number) => {
    lastSelectedRef.current = noteId;
  }, []);

  /** The current selection, read at event time (e.g. drag start). */
  const getSelectedIds = useCallback(() => selectedIdsRef.current, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const note of filteredNotes) next.add(note.noteId);
      return next;
    });
  }, [filteredNotes]);

  const allVisibleSelected =
    filteredNotes.length > 0 &&
    filteredNotes.every((note) => selectedIds.has(note.noteId));

  /**
   * The keyboard shortcuts' targets: the selection in display order (read from
   * the DOM so it tracks the rendered list), or — with nothing selected — the
   * focused row as a run of one.
   */
  const targetNoteIds = useCallback((): number[] => {
    const ids = visibleNoteRows()
      .map((el) => Number(el.dataset.noteId))
      .filter((id) => selectedIds.has(id));
    if (ids.length > 0) return ids;
    const focusedRow = focusedNoteRow();
    return focusedRow ? [Number(focusedRow.dataset.noteId)] : [];
  }, [selectedIds]);

  return {
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
  };
}
