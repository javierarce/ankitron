// Anki note I/O. Notes are the user-facing unit — what the list shows and the
// forms edit; their cards (see ./cards) are the scheduling unit underneath.

import { ankiFetch } from "./anki-fetch";
import { findCardIds } from "./cards";
import type { Note } from "./types";

/** Note ids matching an Anki search query. `deck:"X"` matches descendants,
 * so a deck query already spans its subdecks. */
export async function findNoteIds(query: string): Promise<number[]> {
  return ankiFetch<number[]>("findNotes", { query });
}

/** Full notesInfo rows for `noteIds`. Skips the round trip for an empty list
 * — a common case right after findNoteIds — and just returns []. */
export async function fetchNotes(noteIds: number[]): Promise<Note[]> {
  if (noteIds.length === 0) return [];
  return ankiFetch<Note[]>("notesInfo", { notes: noteIds });
}

/** The payload addNote sends: where the note goes and what it holds. */
export interface NewNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

/** Create a note (its cards land in `deckName`); returns the new note id.
 * Throws on a duplicate — AnkiConnect rejects those rather than adding. */
export async function addNote(note: NewNote): Promise<number> {
  return ankiFetch<number>("addNote", { note });
}

/** An updateNote payload: only the parts being written. */
export interface NoteUpdate {
  id: number;
  fields?: Record<string, string>;
  tags?: string[];
}

/**
 * Write a note's fields and/or tags in one call. Tags are replaced wholesale
 * when present — a removeTags-per-tag loop plus addTags would take N+1
 * requests and could fail midway, leaving the note stripped of all its tags.
 */
export async function updateNote(note: NoteUpdate): Promise<void> {
  await ankiFetch("updateNote", { note });
}

/** Permanently delete notes (and all of their cards). */
export async function deleteNotes(noteIds: number[]): Promise<void> {
  await ankiFetch("deleteNotes", { notes: noteIds });
}

/**
 * Add tags to every listed note. addTags only adds a tag a note lacks, so
 * this is a no-op where it doesn't apply — no client-side dedup needed.
 * (AnkiConnect takes tags as one space-separated string, which also means a
 * tag itself can never contain a space.)
 */
export async function addTagsToNotes(
  noteIds: number[],
  tags: string[],
): Promise<void> {
  await ankiFetch("addTags", { notes: noteIds, tags: tags.join(" ") });
}

/** Remove tags from every listed note; a no-op for notes that lack the tag.
 * Same space-separated contract as addTagsToNotes. */
export async function removeTagsFromNotes(
  noteIds: number[],
  tags: string[],
): Promise<void> {
  await ankiFetch("removeTags", { notes: noteIds, tags: tags.join(" ") });
}

/** Every tag defined in the collection, in Anki's order. */
export async function fetchAllTags(): Promise<string[]> {
  return ankiFetch<string[]>("getTags");
}

/**
 * Move every card of `notes` into `targetDeck` — the one Anki-write sequence
 * behind drag-moves, the Move dialog, and the edit form's deck change.
 * View-state concerns (skipping notes already in the target, selection
 * bookkeeping, refreshes) stay with the callers; this throws on failure so
 * each can surface it its own way.
 */
export async function moveNotesToDeck(
  notes: Note[],
  targetDeck: string,
): Promise<void> {
  let cardIds = notes.flatMap((n) => n.cards ?? []);
  if (cardIds.length === 0) {
    cardIds = await findCardIds(notes.map((n) => `nid:${n.noteId}`).join(" OR "));
  }
  if (cardIds.length === 0) {
    throw new Error(
      notes.length === 1
        ? "Could not find the note to move."
        : "Could not find the notes to move.",
    );
  }
  await ankiFetch("changeDeck", { cards: cardIds, deck: targetDeck });
  // changeDeck writes raw SQL; rebuild Anki's scheduler queues so an active
  // reviewer doesn't keep serving the moved card. Kept as a raw call rather
  // than the reloadCollection helper: component tests mock @/lib/anki-fetch
  // with ankiFetch-only factories, and Vitest rejects reads of exports a mock
  // factory doesn't define.
  await ankiFetch("reloadCollection").catch(() => {});
}
