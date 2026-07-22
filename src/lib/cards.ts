// Anki card I/O. Cards are Anki's scheduling unit; the user-facing unit is
// the note (see ./notes), and everything here exists to serve note-level UI —
// which is why suspension takes explicit card-id lists rather than notes.

import { ankiFetch } from "./anki-fetch";
import type { CardInfo, CardState } from "./types";

/** Card ids matching an Anki search query (e.g. `deck:"Spanish"`, `nid:123`). */
export async function findCardIds(query: string): Promise<number[]> {
  return ankiFetch<number[]>("findCards", { query });
}

/**
 * Full cardsInfo rows for `cardIds`. Anki renders each card's question/answer
 * HTML server-side for this, which dominates the request on large batches —
 * prefer fetchCardDecks/areSuspended when only those facts are needed.
 */
export async function fetchCardsInfo(cardIds: number[]): Promise<CardInfo[]> {
  return ankiFetch<CardInfo[]>("cardsInfo", { cards: cardIds });
}

/**
 * Friendly scheduling state from a card's `queue`/`type` (see CardInfo).
 * `queue === -1` is suspended and overrides everything; otherwise `type` names
 * the state, defaulting to "new" for a card that hasn't been scheduled yet.
 */
export function cardState(card: CardInfo): CardState {
  if (card.queue === -1) return "suspended";
  switch (card.type) {
    case 1:
      return "learning";
    case 2:
      return "review";
    case 3:
      return "relearning";
    default:
      return "new";
  }
}

/**
 * The scheduling state of a single card, or null when it can't be read. Used
 * during study to label the served card (e.g. a "New" badge) — guiCurrentCard
 * carries no type/queue, so this is a separate cardsInfo read. Read it at the
 * moment the card is served: Anki flips a card's type/queue as it's graded, so
 * a later read would report the post-answer state, not the one presented.
 */
export async function fetchCardState(
  cardId: number,
): Promise<CardState | null> {
  const info = await fetchCardsInfo([cardId]);
  return info[0] ? cardState(info[0]) : null;
}

/** The deck holding each card, grouped as { deckName: [cardId, …] }. */
export async function fetchCardDecks(
  cardIds: number[],
): Promise<Record<string, number[]>> {
  return ankiFetch<Record<string, number[]>>("getDecks", { cards: cardIds });
}

/** One suspended flag per input card, in order; null for unknown card ids. */
export async function areSuspended(
  cardIds: number[],
): Promise<(boolean | null)[]> {
  return ankiFetch<(boolean | null)[]>("areSuspended", { cards: cardIds });
}

/**
 * Suspend or unsuspend cards. The app treats suspension as note-level — the
 * card list badges a whole note as suspended and toggles its cards together —
 * so callers pass every card of each affected note (note.cards, or the
 * resolved note's cards during study), keeping that badge accurate for
 * multi-card notes like Basic-and-reversed.
 */
export async function setSuspended(
  cardIds: number[],
  suspended: boolean,
): Promise<void> {
  if (suspended) {
    await ankiFetch("suspend", { cards: cardIds });
  } else {
    await ankiFetch("unsuspend", { cards: cardIds });
  }
}
