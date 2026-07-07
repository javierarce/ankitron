import { ankiFetch } from "./anki-fetch";
import type { Note } from "./types";

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
    cardIds = await ankiFetch<number[]>("findCards", {
      query: notes.map((n) => `nid:${n.noteId}`).join(" OR "),
    });
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
  // reviewer doesn't keep serving the moved card.
  await ankiFetch("reloadCollection").catch(() => {});
}
