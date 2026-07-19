// The card list's window keydown dispatcher. Everything it acts on comes in as
// an argument — selection commands, action callbacks, the search ref — so the
// effect's dependencies are exactly what the handler reads.

import { useEffect, type RefObject } from "react";
import { isScrollLocked } from "@/hooks/use-scroll-lock";
import { visibleNoteRows, focusedNoteRow } from "@/hooks/use-note-selection";

interface CardListShortcutsOptions {
  /** Disabled while any dialog is open — the dialogs own the keyboard then. */
  enabled: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Whether a bulk tag change is currently undoable (gates Cmd+Z). */
  canUndoTags: boolean;
  onTagUndo: () => void;
  /** Whether any notes are selected (gates Escape). */
  hasSelection: boolean;
  /** Empty the selection, keeping the shift anchor. */
  deselectAll: () => void;
  replaceSelection: (ids: number[]) => void;
  addToSelection: (ids: number[]) => void;
  toggleSelected: (id: number) => void;
  setAnchor: (id: number) => void;
  /** The selection in display order, or the focused row with none selected. */
  targetNoteIds: () => number[];
  onAddNote: () => void;
  /** Open the sequential editor over these notes. */
  onEditNotes: (ids: number[]) => void;
  /** Open the statistics dialog over these notes (paging through them). */
  onStatsNotes: (ids: number[]) => void;
  /** Select these notes and open the bulk tag dialog. */
  onTagNotes: (ids: number[]) => void;
  /** Select these notes and open the move dialog. */
  onMoveNotes: (ids: number[]) => void;
  /** Toggle-suspend the notes' cards; returns false when they have none. */
  onSuspendNotes: (ids: number[]) => boolean;
  /** Set (0 clears) a flag on the notes' cards. */
  onFlagNotes: (ids: number[], flag: number) => void;
}

export function useCardListShortcuts({
  enabled,
  searchRef,
  canUndoTags,
  onTagUndo,
  hasSelection,
  deselectAll,
  replaceSelection,
  addToSelection,
  toggleSelected,
  setAnchor,
  targetNoteIds,
  onAddNote,
  onEditNotes,
  onStatsNotes,
  onTagNotes,
  onMoveNotes,
  onSuspendNotes,
  onFlagNotes,
}: CardListShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!enabled) return;
      // A modal overlay above the list (e.g. the command palette) holds the
      // scroll lock; don't let list shortcuts fire behind it.
      if (isScrollLocked()) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
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
        canUndoTags
      ) {
        e.preventDefault();
        onTagUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        const rows = visibleNoteRows();
        if (rows.length > 0) {
          e.preventDefault();
          replaceSelection(rows.map((el) => Number(el.dataset.noteId)));
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && /^[0-7]$/.test(e.key)) {
        // Cmd/Ctrl+1…7 flags the selection (or the focused row); Cmd/Ctrl+0
        // clears it. Matches the study screen's flag shortcuts.
        const ids = targetNoteIds();
        if (ids.length > 0) {
          e.preventDefault();
          onFlagNotes(ids, Number(e.key));
        }
        return;
      }
      if (e.key === "Escape") {
        const focusedRow = focusedNoteRow();
        if (hasSelection || focusedRow) {
          e.preventDefault();
          if (hasSelection) deselectAll();
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
          toggleSelected(id);
          setAnchor(id);
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
        const rows = visibleNoteRows();
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
        addToSelection(ids);
        const targetEl = rows[targetIdx];
        targetEl.focus();
        targetEl.scrollIntoView({ block: "nearest" });
        setAnchor(Number(targetEl.dataset.noteId));
        return;
      }
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onAddNote();
        return;
      }
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Edit the selection in display order; with nothing selected, edit the
        // focused row as a run of one.
        const ids = targetNoteIds();
        if (ids.length > 0) {
          e.preventDefault();
          onEditNotes(ids);
        }
        return;
      }
      if (e.key === "i" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Stats for the selection (paged), or the focused row when nothing is
        // selected — the read-only counterpart to Edit.
        const ids = targetNoteIds();
        if (ids.length > 0) {
          e.preventDefault();
          onStatsNotes(ids);
        }
        return;
      }
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Tag the selection; with nothing selected, tag the focused row by
        // selecting it first so the dialog (which reads the selection) has it.
        const ids = targetNoteIds();
        if (ids.length > 0) {
          e.preventDefault();
          onTagNotes(ids);
        }
        return;
      }
      if (e.key === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Suspend the selection; with nothing selected, act on the focused row.
        const ids = targetNoteIds();
        if (onSuspendNotes(ids)) e.preventDefault();
        return;
      }
      if (e.key === "m" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Move the selection; with nothing selected, move the focused row by
        // selecting it first so the dialog (which reads the selection) has it.
        const ids = targetNoteIds();
        if (ids.length > 0) {
          e.preventDefault();
          onMoveNotes(ids);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    searchRef,
    canUndoTags,
    onTagUndo,
    hasSelection,
    deselectAll,
    replaceSelection,
    addToSelection,
    toggleSelected,
    setAnchor,
    targetNoteIds,
    onAddNote,
    onEditNotes,
    onStatsNotes,
    onTagNotes,
    onMoveNotes,
    onSuspendNotes,
    onFlagNotes,
  ]);
}
