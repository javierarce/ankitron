// Per-note study statistics — the data behind the stats panel that swaps in
// for the edit form.
//
// A note owns one or more cards (Basic-and-reversed → 2, cloze → N), and all
// scheduling lives on the cards, so this module pulls each card's current state
// (cardsInfo) and its full review log (getReviewsOfCards) and folds them into a
// single note-level summary with a per-card breakdown. The shaping is a pure
// function (computeNoteStats) so it can be unit-tested without a live Anki;
// fetchNoteStats is the thin transport wrapper the panel calls.

import { ankiFetch } from "./anki-fetch";
import { cardState, fetchCardsInfo, findCardIds } from "./cards";
import type {
  CardInfo,
  CardReview,
  CardStats,
  Note,
  NoteStats,
} from "./types";

// Anki note ids are the note's creation time in epoch-ms, so the id doubles as
// an "added on" date. Ids below this threshold (~year 2001) can't be real
// timestamps — the demo uses small sequential ids — so treat those as unknown
// rather than reporting a 1970 date.
const MIN_REAL_NOTE_ID = 1_000_000_000_000;

/** The note's creation time (epoch-ms) from its id, or null if not a real id. */
export function noteCreationTime(noteId: number): number | null {
  return noteId >= MIN_REAL_NOTE_ID ? noteId : null;
}

/**
 * Review history for each card, keyed by numeric card id. AnkiConnect keys its
 * result object by the card id as a string; we re-key to numbers so callers
 * index with the same ids they passed in.
 */
export async function fetchReviewsOfCards(
  cardIds: number[],
): Promise<Record<number, CardReview[]>> {
  if (cardIds.length === 0) return {};
  const raw = await ankiFetch<Record<string, CardReview[]>>(
    "getReviewsOfCards",
    { cards: cardIds },
  );
  const byCard: Record<number, CardReview[]> = {};
  for (const [id, reviews] of Object.entries(raw)) {
    byCard[Number(id)] = reviews;
  }
  return byCard;
}

/**
 * Fetch and shape a note's stats. Uses the note's own card list when present
 * (notesInfo already carries it), else resolves it with `nid:` — so the panel
 * works whether it's handed a fully-populated note or just an id.
 */
export async function fetchNoteStats(
  note: Pick<Note, "noteId" | "tags" | "cards">,
): Promise<NoteStats> {
  const cardIds = note.cards?.length
    ? note.cards
    : await findCardIds(`nid:${note.noteId}`);

  const [cards, reviewsByCard] = await Promise.all([
    cardIds.length ? fetchCardsInfo(cardIds) : Promise.resolve([]),
    fetchReviewsOfCards(cardIds),
  ]);

  return computeNoteStats(note, cards, reviewsByCard);
}

// --- Pure shaping -----------------------------------------------------------

/**
 * Current ease as a whole-number percentage (2500 permille → 250). Prefer the
 * card's live factor; fall back to its last review's factor for a card whose
 * cardsInfo omits one. Null before the card has ever earned an ease.
 */
function easePercent(card: CardInfo, reviews: CardReview[]): number | null {
  const factor =
    card.factor && card.factor > 0
      ? card.factor
      : (reviews[reviews.length - 1]?.factor ?? 0);
  return factor > 0 ? Math.round(factor / 10) : null;
}

/**
 * Fold cardsInfo + review logs into a note's stats. Pure — no I/O — so the
 * panel's formatting and the "evolution" charts can be tested against
 * hand-built fixtures.
 */
export function computeNoteStats(
  note: Pick<Note, "noteId" | "tags">,
  cards: CardInfo[],
  reviewsByCard: Record<number, CardReview[]>,
): NoteStats {
  const cardStats: CardStats[] = cards
    .map((card): CardStats => {
      // Keep only graded answers (buttons 1–4). getReviewsOfCards returns raw
      // revlog rows, which on a real collection include manual reschedules —
      // Anki desktop's Forget / Set Due Date write rows with ease 0 (type 4)
      // that aren't answer presses. Counting them would inflate the review
      // total, drag the success rate down, leave the Answers bar under 100%,
      // and render as blank "?" dots. filter() also returns a fresh array, so
      // the sort never mutates the caller's data.
      const reviews = (reviewsByCard[card.cardId] ?? [])
        .filter((r) => r.ease >= 1 && r.ease <= 4)
        .sort((a, b) => a.id - b.id);
      return {
        cardId: card.cardId,
        ord: card.ord ?? 0,
        state: cardState(card),
        intervalDays: Math.max(0, card.interval ?? 0),
        easePercent: easePercent(card, reviews),
        reps: card.reps ?? reviews.length,
        lapses: card.lapses ?? 0,
        reviews,
      };
    })
    .sort((a, b) => a.ord - b.ord);

  const allReviews = cardStats.flatMap((c) => c.reviews);
  const gradeCounts = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const r of allReviews) {
    if (r.ease === 1) gradeCounts.again++;
    else if (r.ease === 2) gradeCounts.hard++;
    else if (r.ease === 3) gradeCounts.good++;
    else if (r.ease === 4) gradeCounts.easy++;
  }
  const passes = gradeCounts.hard + gradeCounts.good + gradeCounts.easy;
  const times = allReviews.map((r) => r.id);

  return {
    noteId: note.noteId,
    createdAt: noteCreationTime(note.noteId),
    firstReviewedAt: times.length ? Math.min(...times) : null,
    lastReviewedAt: times.length ? Math.max(...times) : null,
    totalReviews: allReviews.length,
    totalLapses: cardStats.reduce((sum, c) => sum + c.lapses, 0),
    totalTimeMs: allReviews.reduce((sum, r) => sum + (r.time ?? 0), 0),
    successRate: allReviews.length ? passes / allReviews.length : null,
    gradeCounts,
    intervalDays: cardStats.reduce((max, c) => Math.max(max, c.intervalDays), 0),
    easePercent:
      cardStats.find((c) => c.easePercent != null)?.easePercent ?? null,
    isLeech: note.tags.includes("leech"),
    cards: cardStats,
  };
}
