export interface AnkiRequest {
  action: string;
  version: 6;
  params?: Record<string, unknown>;
}

export interface AnkiResponse<T = unknown> {
  result: T;
  error: string | null;
}

export interface NoteField {
  value: string;
  order: number;
}

export interface Note {
  noteId: number;
  modelName: string;
  fields: Record<string, NoteField>;
  tags: string[];
  cards?: number[];
  /** Last-modified time in epoch seconds, as reported by AnkiConnect. */
  mod?: number;
}

export interface Card {
  cardId: number;
  noteId: number;
  deckName: string;
  fields: Record<string, NoteField>;
  tags: string[];
  question: string;
  answer: string;
}

/**
 * A row from AnkiConnect's `cardsInfo`, narrowed to the fields the app reads.
 * The owning note id has shipped under both `note` and `noteId` across
 * AnkiConnect versions, so both are optional here and resolveNoteForCard
 * (lib/review.ts) checks the two in order.
 *
 * The scheduling fields (interval…factor) are what the per-note stats panel
 * reads; they're all optional because most call sites only want the
 * note/deck/field identity above and never ask for them.
 */
export interface CardInfo {
  cardId: number;
  note?: number;
  noteId?: number;
  deckName: string;
  modelName?: string;
  fields: Record<string, NoteField>;
  question: string;
  answer: string;
  /** Position of this card within its note's template list (0-based). */
  ord?: number;
  /** Card type: 0 new, 1 learning, 2 review, 3 relearning. */
  type?: number;
  /** Queue: -1 suspended, 0 new, 1 learning, 2 review, 3 day-learning. */
  queue?: number;
  /** Current interval in days (negative values are seconds, for sub-day steps). */
  interval?: number;
  /** Total reviews so far. */
  reps?: number;
  /** Times this card has lapsed (been forgotten after graduating). */
  lapses?: number;
  /** Ease factor in permille (2500 = 250%); 0 before the card has an ease. */
  factor?: number;
}

/**
 * One row of a card's review history, from `getReviewsOfCards`. The terse key
 * names are Anki's own database columns (see the AnkiConnect docs), kept as-is.
 */
export interface CardReview {
  /** Review time in epoch-ms; also the row's unique, monotonic id. */
  id: number;
  usn: number;
  /**
   * Button pressed: 1 Again, 2 Hard, 3 Good, 4 Easy — but the raw revlog also
   * carries non-answer rows (manual Forget / Set Due Date) with ease 0, so this
   * is a plain number. computeNoteStats filters to 1–4 before aggregating.
   */
  ease: number;
  /** Interval assigned by this review (days if >0, seconds if <0). */
  ivl: number;
  /** Interval the card had going into this review. */
  lastIvl: number;
  /** Ease factor after this review, in permille (2500 = 250%). */
  factor: number;
  /** Time spent answering, in milliseconds. */
  time: number;
  /** Review kind: 0 learning, 1 review, 2 relearning, 3 filtered/cram, 4 manual. */
  type: number;
}

/** A card's scheduling state, as a friendly label for the stats panel. */
export type CardState =
  | "new"
  | "learning"
  | "review"
  | "relearning"
  | "suspended";

/** One card's contribution to a note's stats: current state plus its log. */
export interface CardStats {
  cardId: number;
  ord: number;
  state: CardState;
  /** Current interval in days (0 for a card that isn't scheduled yet). */
  intervalDays: number;
  /** Current ease as a percentage (250 for 2.5×), or null before first review. */
  easePercent: number | null;
  reps: number;
  lapses: number;
  /** Full review history, oldest first. */
  reviews: CardReview[];
}

/**
 * Everything the per-note stats panel needs, folded across all of a note's
 * cards. Built by computeNoteStats (lib/note-stats.ts) from cardsInfo +
 * getReviewsOfCards, so it's a pure function of those two inputs and testable
 * without a live Anki.
 */
export interface NoteStats {
  noteId: number;
  /** Note creation time in epoch-ms (from the note id), or null if unknown. */
  createdAt: number | null;
  /** First and most recent review across the note's cards, epoch-ms. */
  firstReviewedAt: number | null;
  lastReviewedAt: number | null;
  /** Total review-log rows across all cards. */
  totalReviews: number;
  /** Total lapses across all cards. */
  totalLapses: number;
  /** Total answering time across all reviews, in milliseconds. */
  totalTimeMs: number;
  /** Fraction of reviews graded better than Again (0–1), or null if none. */
  successRate: number | null;
  /** How often each button was pressed across the note's whole history. */
  gradeCounts: { again: number; hard: number; good: number; easy: number };
  /** The furthest-out interval across the note's cards, in days. */
  intervalDays: number;
  /** A representative current ease (%), from the note's primary card. */
  easePercent: number | null;
  /** True when Anki has tagged the note a leech (the `leech` tag). */
  isLeech: boolean;
  /** Per-card breakdown, in template order. */
  cards: CardStats[];
}

/** The reviewer's current card, as returned by `guiCurrentCard`. */
export interface CurrentCard {
  cardId: number;
  question: string;
  answer: string;
  deckName: string;
  fields: Record<string, NoteField>;
}

/**
 * One deck's entry in `getDeckStats`' result. The result object is keyed by
 * deck id (as a string) and `name` is only the leaf — see fetchAllDueCounts
 * (lib/anki-fetch.ts) for mapping ids back to full deck paths.
 */
export interface DeckStats {
  deck_id: number;
  name: string;
  new_count: number;
  learn_count: number;
  review_count: number;
  total_in_deck: number;
}

export type Ease = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface DueCounts {
  new: number;
  learn: number;
  review: number;
}

/** Today's study totals, mirroring Anki's "Studied N cards in M minutes" line. */
export interface StudyStats {
  /** Number of reviews logged today (respects Anki's day-rollover hour). */
  cards: number;
  /** Total time spent reviewing today, in seconds. */
  seconds: number;
}
