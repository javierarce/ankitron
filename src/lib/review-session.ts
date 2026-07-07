// The study-session state machine, extracted from pages/study.tsx so the
// deck walking, stale-queue recovery, and re-enter decisions are testable
// (see review-session.test.ts, which drives them against the demo mock). The
// page keeps presentation — fades, React state, error copy — and every
// reviewer-protocol decision lives here, built on the typed gui-reviewer
// calls in ./review (see that module for the protocol's statefulness).

import { reloadCollection } from "./anki-fetch";
import { fetchCardsInfo, setSuspended } from "./cards";
import { isCardInDeck } from "./deck";
import {
  fetchCurrentCard,
  resolveNoteForCard,
  startCardTimer,
  startDeckReview,
} from "./review";
import type { CurrentCard } from "./types";

/**
 * One study session: the decks it reviews, in order, and a cursor to the deck
 * currently being reviewed. The decks are disjoint subtrees (see
 * coveringDecks) so none is studied twice; Anki reviews one deck at a time,
 * so nextCard steps through them, re-entering review as each empties.
 */
export interface ReviewSession {
  readonly decks: readonly string[];
  deckIdx: number;
}

/** The outcome of asking the session for its next card. */
export type NextCardResult =
  | { kind: "card"; card: CurrentCard }
  | { kind: "completed" }
  | { kind: "error"; error: unknown };

export function createReviewSession(
  studyDecks: readonly string[],
): ReviewSession {
  return { decks: studyDecks, deckIdx: 0 };
}

/**
 * Enter review on the session's first deck. Throws when Anki is unreachable
 * or refuses to start — the caller owns the "could not start" messaging.
 */
export async function startSession(session: ReviewSession): Promise<void> {
  session.deckIdx = 0;
  await startDeckReview(session.decks[0]);
}

/**
 * Serve the session's next card. Walks the remaining decks from the active
 * one; each deck's queue is reviewed in turn, and when one empties review is
 * re-entered on the next. Completes only once every deck is exhausted. A
 * transport failure mid-walk comes back as an "error" result — never as a
 * false completion — so the page can tell "you're done" from "Anki went
 * away".
 */
export async function nextCard(
  session: ReviewSession,
): Promise<NextCardResult> {
  try {
    for (let i = session.deckIdx; i < session.decks.length; i++) {
      const deck = session.decks[i];
      // The first deck is already in review (entered by startSession/the
      // prior card); enter each subsequent deck as we reach it.
      if (i !== session.deckIdx) {
        await startDeckReview(deck);
      }
      let result = await fetchCurrentCard();
      // A foreign card here usually means the reviewer queue is stale —
      // changeDeck writes raw SQL, so moving the current card to another deck
      // leaves it queued. Rebuild the queues and re-enter review once before
      // moving on from this deck.
      if (result?.deckName && !isCardInDeck(result.deckName, deck)) {
        await reloadCollection();
        await startDeckReview(deck);
        result = await fetchCurrentCard();
      }
      // Anki's "current card" is collection-wide; only serve one that belongs
      // to this deck (or the page's breadcrumb would mismatch the card).
      // Anything else means this deck is done — advance to the next.
      if (result && result.deckName && isCardInDeck(result.deckName, deck)) {
        session.deckIdx = i;
        await startCardTimer();
        return { kind: "card", card: result };
      }
    }
    return { kind: "completed" };
  } catch (error) {
    return { kind: "error", error };
  }
}

/**
 * Re-enter review on the session's current deck, rebuilding the reviewer's
 * cached queue, then serve the next card. This is the shared recovery move
 * after anything that edits the collection under the open reviewer — undo,
 * suspend, adding a note, an edit that moved the card away. The re-enter
 * itself is best-effort: a failure is ignored so nextCard can surface any
 * real problem.
 */
export async function reenterAndLoad(
  session: ReviewSession,
): Promise<NextCardResult> {
  try {
    await startDeckReview(session.decks[session.deckIdx]);
  } catch {
    // ignore — nextCard will surface any real failure
  }
  return nextCard(session);
}

/**
 * Suspend the whole note behind `card`, then advance to the next card.
 *
 * The whole note, not just this card: the rest of the app treats suspension
 * as note-level — the card list shows a note as suspended and toggles all its
 * cards together — so suspending a single card of a multi-card note (e.g. the
 * forward side of a Basic-and-reversed note) would leave the list unable to
 * represent the partial state. guiCurrentCard doesn't return a note id, so
 * the note is resolved from the card, falling back to just this card if
 * resolution fails.
 *
 * The offscreen reviewer's queue still holds the just-suspended card(s), so
 * review is re-entered to rebuild it (queue -1 cards drop out) before serving
 * the next card. Suspending isn't a review — the caller's reviewed count is
 * untouched. Throws when the suspension itself fails, so the page can show
 * its suspend-specific error.
 */
export async function suspendCurrentAndAdvance(
  session: ReviewSession,
  card: CurrentCard,
): Promise<NextCardResult> {
  const note = await resolveNoteForCard(card.cardId);
  const cardIds = note?.cards?.length ? note.cards : [card.cardId];
  await setSuspended(cardIds, true);
  await startDeckReview(session.decks[session.deckIdx]);
  return nextCard(session);
}

/**
 * Re-render an edited card *in place*, without re-entering review.
 * guiDeckReview rebuilds the scheduler queue and serves whatever card lands
 * on top — usually a different one — which is why an edit would otherwise
 * jump to the next card. cardsInfo renders straight from the collection (the
 * offscreen reviewer caches its current card and wouldn't show the edit
 * without a queue rebuild), so it gives the freshly rendered question and
 * answer for the exact card just edited; the reviewer's current card is
 * untouched, so grading still lands on it.
 *
 * Returns null when staying in place is wrong and the caller should rebuild
 * the queue instead (reenterAndLoad): a note-type change deletes and replaces
 * the card (cardsInfo comes back empty), a deck move sends it elsewhere, and
 * a fetch failure means we can't know.
 */
export async function refreshCurrentCard(
  session: ReviewSession,
  cardId: number,
): Promise<CurrentCard | null> {
  try {
    const info = await fetchCardsInfo([cardId]);
    const ci = info[0];
    if (
      ci &&
      ci.deckName &&
      isCardInDeck(ci.deckName, session.decks[session.deckIdx])
    ) {
      return {
        cardId: ci.cardId,
        question: ci.question,
        answer: ci.answer,
        deckName: ci.deckName,
        fields: ci.fields,
      };
    }
  } catch {
    // fall through to a queue rebuild
  }
  return null;
}

/**
 * Whether the study undo (z) action is allowed. Undo only steps back through
 * reviews made in the current deck's session, so it's blocked once the
 * session is complete (no card to return to — it would silently revert a
 * review off-screen) and before anything has been reviewed.
 */
export function canUndo(state: {
  completed: boolean;
  reviewed: number;
}): boolean {
  return !state.completed && state.reviewed > 0;
}
