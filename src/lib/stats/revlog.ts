// The collection's review log — the single expensive read behind every Stats
// chart, fetched once per session and shared by all of them.
//
// Two facts about AnkiConnect's `cardReviews` shape this module:
//
//   - It reports only a deck's OWN cards (not subdecks), so a collection-wide
//     read is a per-deck fan-out. Its rows carry a cardId but no deck, and
//     recovering card → deck afterwards would mean a cardsInfo call — which
//     renders every card's question/answer HTML server-side and would dwarf
//     this request. Instead we tag each row with the deck we fetched it under,
//     which is free, so one fetch serves "All decks" and every deck filter as
//     a client-side predicate (see filterByDeck).
//
//   - It cannot be cached incrementally. The obvious optimisation — remember
//     the newest review id, then refetch with startID: max + 1 — is unsound,
//     because reviews synced from another device arrive carrying their
//     ORIGINAL timestamps, which can predate that high-water mark. They'd be
//     silently dropped forever. The revlog is append-only per device, not per
//     collection, so callers fetch the whole history and cache the result.

import { ankiMulti } from "../anki-fetch";
import { isCardInDeck } from "../deck";

// A `cardReviews` row is positional:
// [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type].
const R_ID = 0;
const R_CARD_ID = 1;
const R_EASE = 3;
const R_IVL = 4;
const R_LAST_IVL = 5;
const R_FACTOR = 6;
const R_DURATION_MS = 7;
const R_TYPE = 8;

/** Anki's revlog `type` column. */
export const REVLOG_TYPE = {
  learning: 0,
  review: 1,
  relearning: 2,
  /** Filtered-deck / cram review — outside the normal schedule. */
  cram: 3,
  /** Forget / Set Due Date. Carries ease 0: not an answer press. */
  manual: 4,
} as const;

/**
 * One parsed `cardReviews` row. Field names match the existing CardReview
 * (types.ts) — which comes from getReviewsOfCards and lacks a cardId — plus the
 * two facts the positional form carries: which card, and which deck we fetched
 * it under.
 */
export interface RevlogEntry {
  /** Review time in epoch-ms; also the row's unique id. */
  id: number;
  cardId: number;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. 0 on manual reschedule rows. */
  ease: number;
  /** Interval assigned by this review: days if > 0, seconds if < 0. */
  ivl: number;
  /** Interval going into this review, same units. */
  lastIvl: number;
  /** Ease factor after this review, in permille (2500 = 250%). */
  factor: number;
  /** Time spent answering, in milliseconds. */
  timeMs: number;
  /** See REVLOG_TYPE. */
  type: number;
  /**
   * The deck the card lives in *now*. Anki attributes reviews by a card's
   * current deck, so moving a card rewrites where its past reviews appear.
   * Collection-wide figures are unaffected; per-deck ones drift.
   */
  deck: string;
}

export function parseRevlogRow(row: number[], deck: string): RevlogEntry {
  return {
    id: row[R_ID],
    cardId: row[R_CARD_ID],
    ease: row[R_EASE],
    ivl: row[R_IVL],
    lastIvl: row[R_LAST_IVL],
    factor: row[R_FACTOR],
    timeMs: row[R_DURATION_MS] ?? 0,
    type: row[R_TYPE],
    deck,
  };
}

/**
 * True for a real answer press (buttons 1–4). The raw revlog also carries
 * manual reschedule rows written by Anki desktop's Forget / Set Due Date, which
 * have ease 0 — counting those would inflate review totals and drag pass rates
 * down. Every aggregate in this directory filters on it.
 */
export function isGraded(entry: RevlogEntry): boolean {
  return entry.ease >= 1 && entry.ease <= 4;
}

/**
 * Scope entries to a deck and its subdecks. `undefined` means the whole
 * collection, which is the Stats page's default. Reuses isCardInDeck so the
 * "Spanish" / "Spanish 2" / "SpanishAdvanced" prefix traps stay handled in one
 * place.
 */
export function filterByDeck(
  entries: RevlogEntry[],
  deckName?: string,
): RevlogEntry[] {
  if (!deckName) return entries;
  return entries.filter((e) => isCardInDeck(e.deck, deckName));
}

/**
 * Every revlog row for the given decks, tagged with its deck. `deckNames` must
 * be the fully expanded list (`cardReviews` is not subtree-recursive), and
 * startID 0 — the default — means all history.
 *
 * A single deck's failure resolves to no rows and sets `partial`, so one
 * unreadable subdeck never costs the user the whole page. Throws only when
 * EVERY deck failed: an all-failed read means "we don't know your history",
 * which is not the same as "you have no history" — collapsing both to an empty
 * result would tell a user with years of reviews that they've never studied.
 */
export async function fetchCollectionRevlog(
  deckNames: string[],
  startID = 0,
): Promise<{ entries: RevlogEntry[]; partial: boolean }> {
  if (deckNames.length === 0) return { entries: [], partial: false };

  // One request for the whole collection. A per-deck fan-out costs a round trip
  // each (26 decks measured at ~650ms), because AnkiConnect serialises on
  // Anki's main thread. `multi` reports each deck's outcome separately, which
  // is exactly the per-deck failure tolerance this needs.
  const outcomes = await ankiMulti<number[][]>(
    deckNames.map((deck) => ({ action: "cardReviews", params: { deck, startID } })),
  );
  const perDeck = deckNames.map((deck, i) => {
    const outcome = outcomes[i];
    return outcome?.ok
      ? { ok: true, deck, rows: outcome.value ?? [] }
      : { ok: false, deck, rows: [] as number[][] };
  });

  if (perDeck.every((r) => !r.ok)) {
    throw new Error("Could not read review history from Anki.");
  }

  // Dedupe by review id, first occurrence wins. A card belongs to exactly one
  // deck so overlap shouldn't happen, but a caller passing both a parent and
  // its subdeck to a future subtree-aware Anki would otherwise double-count
  // every figure on the page.
  const seen = new Set<number>();
  const entries: RevlogEntry[] = [];
  for (const { deck, rows } of perDeck) {
    for (const row of rows) {
      const id = row[R_ID];
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push(parseRevlogRow(row, deck));
    }
  }

  return { entries, partial: perDeck.some((r) => !r.ok) };
}
