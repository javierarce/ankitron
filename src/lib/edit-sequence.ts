import type { Note } from "./types";

/**
 * State for editing a selection of cards one at a time ("Update Card" advances
 * to the next). Kept as pure data + transitions so the cursor logic — including
 * the fiddly type-change case, where a save replaces the note with a new id —
 * can be unit-tested without rendering the editor.
 */
export interface EditSequence {
  /** Note ids to walk, in display order. A type change repoints its slot. */
  ids: number[];
  /** Cursor into `ids`. */
  index: number;
  /**
   * Notes saved during the run, keyed by id, so paging back shows the new text
   * (and type) without a reload.
   */
  edited: Record<number, Note>;
  /** Whether any save wrote something, so the caller reloads only when needed. */
  dirty: boolean;
}

/** The result of advancing: either a new state, or the run is finished. */
export type SequenceStep =
  | { done: false; seq: EditSequence }
  | { done: true; dirty: boolean };

/** Start a run over `ids`, or null when there's nothing to edit. */
export function createEditSequence(ids: number[]): EditSequence | null {
  return ids.length > 0 ? { ids, index: 0, edited: {}, dirty: false } : null;
}

/** Move back one card, clamped at the start. Edits made so far are kept. */
export function editSequencePrev(seq: EditSequence): EditSequence {
  return { ...seq, index: Math.max(0, seq.index - 1) };
}

/** Advance past the current card, finishing the run at the end. */
export function editSequenceNext(seq: EditSequence): SequenceStep {
  if (seq.index < seq.ids.length - 1) {
    return { done: false, seq: { ...seq, index: seq.index + 1 } };
  }
  return { done: true, dirty: seq.dirty };
}

/**
 * Record a successful save, then advance. `updated` is the written note, or
 * undefined for a no-op save (paged-through, untouched card). When a type change
 * gives the note a new id, the current slot is repointed at it so back-nav finds
 * the updated card rather than the deleted original.
 */
export function editSequenceSaved(
  seq: EditSequence,
  updated?: Note,
): SequenceStep {
  if (!updated) return editSequenceNext(seq);
  const oldId = seq.ids[seq.index];
  const ids =
    updated.noteId !== oldId
      ? seq.ids.map((id, i) => (i === seq.index ? updated.noteId : id))
      : seq.ids;
  return editSequenceNext({
    ...seq,
    ids,
    edited: { ...seq.edited, [updated.noteId]: updated },
    dirty: true,
  });
}

/**
 * Drop the current card from the run after it's been deleted from Anki. The
 * next card slides into the current slot so the cursor stays put — except when
 * the deleted card was last, where it steps back one. Finishes the run when the
 * deleted card was the only one left. Always marks the run dirty so the caller
 * reloads the list when the run ends.
 */
export function editSequenceDeleted(seq: EditSequence): SequenceStep {
  const ids = seq.ids.filter((_, i) => i !== seq.index);
  if (ids.length === 0) return { done: true, dirty: true };
  const removedId = seq.ids[seq.index];
  const edited = { ...seq.edited };
  delete edited[removedId];
  const index = Math.min(seq.index, ids.length - 1);
  return { done: false, seq: { ...seq, ids, index, edited, dirty: true } };
}

/** The id of the card currently being edited. */
export function editSequenceCurrentId(seq: EditSequence): number {
  return seq.ids[seq.index];
}

/**
 * The note currently being edited: the saved version if one exists, otherwise
 * the original from `notes`. Null if it's no longer present (e.g. moved away).
 */
export function editSequenceCurrentNote(
  seq: EditSequence,
  notes: Note[],
): Note | null {
  const id = seq.ids[seq.index];
  return seq.edited[id] ?? notes.find((n) => n.noteId === id) ?? null;
}
