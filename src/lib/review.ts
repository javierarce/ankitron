// The gui-reviewer protocol. Anki's GUI review actions are stateful:
// startDeckReview opens a session on a deck (subtree-inclusive),
// fetchCurrentCard serves the card on top of its queue, showAnswer flips the
// offscreen reviewer to the answer side, and answerCard grades and advances.
// The reviewer caches its queue, so anything that edits the collection under
// it (suspend, add, undo, deck moves) must re-enter review — call
// startDeckReview again — to rebuild the queue before fetching the next card.

import { ankiFetch } from "./anki-fetch";
import type { CardInfo, CurrentCard, Ease, Note } from "./types";

/**
 * Enter (or re-enter) review on `deck`. Entering is also the recovery move:
 * it rebuilds the scheduler queue, dropping suspended/moved cards and picking
 * up added or undone ones.
 */
export async function startDeckReview(deck: string): Promise<void> {
  await ankiFetch("guiDeckReview", { name: deck });
}

/**
 * The reviewer's current card, or null when the queue is empty. Anki's
 * "current card" is collection-wide, so callers must check its deckName
 * against the deck they're studying before showing it.
 */
export async function fetchCurrentCard(): Promise<CurrentCard | null> {
  return ankiFetch<CurrentCard | null>("guiCurrentCard");
}

/**
 * Flip the offscreen reviewer to the answer side. Grading (answerCard) only
 * works once the answer is shown, so this must land before a grade — and
 * again after anything that resets the reviewer to the question side, like
 * editing the note.
 */
export async function showAnswer(): Promise<void> {
  await ankiFetch("guiShowAnswer");
}

/** Grade the current card; resolves true when Anki accepted the answer. */
export async function answerCard(ease: Ease): Promise<boolean> {
  return ankiFetch<boolean>("guiAnswerCard", { ease });
}

/**
 * Undo the last review. Anki's undo is global and the reviewer defers its own
 * refresh until focused, so callers re-enter review (startDeckReview) after
 * this to serve the undone card again.
 */
export async function undoReview(): Promise<void> {
  await ankiFetch("guiUndo");
}

/** Restart the current card's answer timer, so time-to-answer is measured
 * from when the card was actually shown. */
export async function startCardTimer(): Promise<void> {
  await ankiFetch("guiStartCardTimer");
}

/**
 * The note behind a card. guiCurrentCard doesn't return a note id, so study
 * actions that need the note (edit, suspend-the-whole-note) resolve it in two
 * hops: cardsInfo for the owning note id — exposed as `noteId` or `note`
 * depending on the AnkiConnect version, so both are checked — then notesInfo
 * for the note itself. Returns null when either hop comes back empty;
 * transport failures still throw so callers can treat them as real errors.
 */
export async function resolveNoteForCard(cardId: number): Promise<Note | null> {
  const cards = await ankiFetch<CardInfo[]>("cardsInfo", { cards: [cardId] });
  const noteId = cards[0]?.noteId ?? cards[0]?.note;
  if (!noteId) return null;
  const notes = await ankiFetch<Note[]>("notesInfo", { notes: [noteId] });
  return notes[0] ?? null;
}
