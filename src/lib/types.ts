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
