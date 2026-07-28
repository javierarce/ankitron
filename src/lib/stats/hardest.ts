// Trouble spots — the cards that keep failing, as a fix-list.
//
// Every other block on the Stats page describes; this one points at something
// the user can act on: the handful of notes eating a disproportionate share
// of lapses and time. Ranking comes straight from the cached revlog (no new
// fetch); only the top few candidates are resolved to their notes via
// cardsInfo, which renders card HTML server-side and so must never be called
// for the whole collection.

import { ankiFetch } from "../anki-fetch";
import { stripCloze } from "../cloze";
import { stripHtml } from "../html-text";
import { noteDisplayFields } from "../note-fields";
import type { CardInfo } from "../types";
import { isGraded, REVLOG_TYPE, type RevlogEntry } from "./revlog";

/** A card's failure tally, before its note is known. */
export interface HardCard {
  cardId: number;
  /** Again presses on scheduled reviews — Anki's definition of a lapse. */
  lapses: number;
  /** Graded answers of any kind. */
  reviews: number;
  /** Total time spent answering, in seconds. */
  seconds: number;
}

/** A trouble spot, resolved to the note the user can go fix. */
export interface HardestNote {
  noteId: number;
  /** The note's front, as plain text. */
  front: string;
  deckName: string;
  lapses: number;
  reviews: number;
  seconds: number;
}

/**
 * A note must have failed at least this often to count as a trouble spot.
 * One lapse is normal forgetting; a repeat offender is the thing worth a
 * rewrite, an extra example, or a mnemonic.
 */
const MIN_LAPSES = 2;

/** How many trouble spots the page shows — even, so the 2-column grid has no orphan tile. */
const DISPLAY_LIMIT = 6;

/**
 * Resolve more candidates than the display needs: several cards can collapse
 * into one note (reversed/cloze siblings), and a card whose note has been
 * deleted resolves to nothing.
 */
const CANDIDATE_LIMIT = 24;

/**
 * Rank cards by how often they fail. Pure — a fold over the (already deck-
 * scoped) revlog. Lapses count Again presses on scheduled reviews only:
 * failing a learning step is part of learning, not evidence the card is a
 * problem, and counting relearning steps would double-charge each lapse.
 */
export function computeHardestCards(
  entries: RevlogEntry[],
  sinceMs = 0,
  limit = CANDIDATE_LIMIT,
): HardCard[] {
  const byCard = new Map<number, HardCard>();

  for (const e of entries) {
    // Windowed (the page passes the same rolling year as retention): a card
    // that was hard years ago and has been solid since is not a CURRENT
    // trouble spot, and surfacing it would send the user to fix a note that
    // no longer needs fixing.
    if (e.id < sinceMs) continue;
    if (!isGraded(e)) continue;
    let card = byCard.get(e.cardId);
    if (!card) {
      card = { cardId: e.cardId, lapses: 0, reviews: 0, seconds: 0 };
      byCard.set(e.cardId, card);
    }
    card.reviews++;
    card.seconds += e.timeMs / 1000;
    if (e.ease === 1 && e.type === REVLOG_TYPE.review) card.lapses++;
  }

  return [...byCard.values()]
    .filter((c) => c.lapses >= MIN_LAPSES)
    .sort((a, b) => b.lapses - a.lapses || b.seconds - a.seconds)
    .slice(0, limit);
}

/**
 * Resolve ranked cards to their notes, merging sibling cards of the same note
 * (their lapses and time are one note's problem, not two). Cards whose notes
 * no longer resolve are dropped, and so are SUSPENDED cards: the fix-list
 * points at active friction, and a suspended card is one the user already
 * dealt with — usually because Anki's leech action suspended it for exactly
 * the lapses that rank it here, which would fill the list with parked cards.
 * Suspension only exists in cardsInfo, not the revlog, so the filter lives at
 * this step rather than in the ranking. Throws on a failed cardsInfo read —
 * the caller degrades the block, matching the forecast's contract.
 */
export async function resolveHardestNotes(
  cards: HardCard[],
): Promise<HardestNote[]> {
  if (cards.length === 0) return [];

  const infos = await ankiFetch<CardInfo[]>("cardsInfo", {
    cards: cards.map((c) => c.cardId),
  });
  const infoByCard = new Map(infos.map((i) => [i.cardId, i]));

  const byNote = new Map<number, HardestNote>();
  for (const card of cards) {
    const info = infoByCard.get(card.cardId);
    const noteId = info?.noteId ?? info?.note;
    if (!info || !noteId) continue;
    // queue -1 is suspended. A suspended sibling contributes nothing; its
    // note still appears if another of its cards is active and lapsing.
    if (info.queue === -1) continue;
    const existing = byNote.get(noteId);
    if (existing) {
      existing.lapses += card.lapses;
      existing.reviews += card.reviews;
      existing.seconds += card.seconds;
    } else {
      byNote.set(noteId, {
        noteId,
        front: frontText(info),
        deckName: info.deckName,
        lapses: card.lapses,
        reviews: card.reviews,
        seconds: card.seconds,
      });
    }
  }

  return [...byNote.values()]
    .sort((a, b) => b.lapses - a.lapses || b.seconds - a.seconds)
    .slice(0, DISPLAY_LIMIT);
}

/**
 * The note's front as plain text, read from its FIELDS — the same source the
 * card list rows use (noteDisplayFields + stripCloze) — never from the
 * rendered `question` HTML. The rendered form leads with the card template's
 * entire stylesheet and carries template directives like [[type:cloze:Text]],
 * so a list built from it opened with ".card { font-family: arial; … }".
 * The question is only a last resort for a card whose fields are missing.
 */
function frontText(info: CardInfo): string {
  const primary = noteDisplayFields({
    modelName: info.modelName ?? "",
    fields: info.fields ?? {},
  }).primary;
  return stripCloze(stripHtml(primary || info.question));
}
