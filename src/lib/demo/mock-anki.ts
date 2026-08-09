// In-memory Anki simulator for the marketing demo build (VITE_DEMO=1).
//
// The whole app talks to Anki through a single chokepoint — ankiFetch(action,
// params) in ../anki-fetch.ts — so faking that one function lets the *real* UI
// run in a plain browser tab with no Anki, no AnkiConnect, and no backend. This
// module is dynamically imported only in the demo build, so it (and its
// fixtures) are tree-shaken out of the shipped Tauri app.
//
// It models just enough of AnkiConnect to drive the read flows (deck list, deck
// detail, study) and the stateful reviewer protocol (guiDeckReview →
// guiCurrentCard → guiShowAnswer → guiAnswerCard, plus undo/suspend). Write
// actions from the add/edit forms mutate this in-memory model so they feel real
// for the session; a reload resets everything to the fixtures.
//
// The content itself (decks and notes) lives as real Ankitron deck files under
// ./decks — see ./fixtures, which loads and validates them. This module is just
// the simulator logic.

import { isCardInDeck } from "../deck";
import type { CardReview, Ease } from "../types";
import { notesMatchingSearch } from "./match-query";
import {
  addDemoNote,
  DECKS,
  DEMO_MEDIA,
  DEMO_STATS,
  ensureDeck,
  NOTES,
  persistDemoState,
  removeDeckSubtree,
  type DemoNote,
} from "./fixtures";

// cardId is derived 1:1 from noteId (every fixture note is a single Basic card),
// offset so card and note ids never collide by accident.
const CARD_OFFSET = 100_000;
const cardIdOf = (noteId: number) => CARD_OFFSET + noteId;
const noteIdOfCard = (cardId: number) => cardId - CARD_OFFSET;

const deckId = (name: string) => DECKS.find((d) => d.name === name)?.id ?? 0;

// ---------------------------------------------------------------------------
// Helpers over the model
// ---------------------------------------------------------------------------

const notesInSubtree = (root: string) =>
  NOTES.filter((n) => isCardInDeck(n.deckName, root));

const findNote = (noteId: number) => NOTES.find((n) => n.noteId === noteId);

const isDue = (n: DemoNote) => !n.suspended && n.state !== "done";

// Anki's question/answer HTML. A Basic card's question is just the Front; its
// answer is the Front, an `<hr id=answer>` divider, then the Back — exactly the
// shape StudyCard splits on to render the two halves.
const questionHtml = (n: DemoNote) => `<div class="card">${n.front}</div>`;
const answerHtml = (n: DemoNote) =>
  `${questionHtml(n)}<hr id="answer"><div class="card">${n.back}</div>`;

const fieldsOf = (n: DemoNote) => ({
  Front: { value: n.front, order: 0 },
  Back: { value: n.back, order: 1 },
});

// AnkiConnect's notesInfo shape.
const noteInfo = (n: DemoNote) => ({
  noteId: n.noteId,
  modelName: n.modelName,
  fields: fieldsOf(n),
  tags: n.tags,
  cards: [cardIdOf(n.noteId)],
  mod: 1_700_000_000,
});

// A fixed "now" so synthesized review histories (and the schedule derived from
// them) are deterministic — the demo build has no real scheduler, and tests
// need stable output. Matches the seconds-scale `mod` used in noteInfo above.
const DEMO_NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

// A plausible review history for a note, shaped by its demo `state`. New notes
// have none; learning notes have a step or two; review/done notes climb a
// growing-interval ladder, and every third note takes a lapse partway so the
// panel's failure→relearn→regrow story has something to show. Deterministic in
// the note id, so the demo and its tests are stable without a clock or RNG.
const demoReviews = (n: DemoNote): CardReview[] => {
  if (n.state === "new") return [];

  type Step = { daysAgo: number; ease: Ease; type: number; ivl: number };
  const steps: Step[] = [];
  if (n.state === "learn") {
    steps.push({ daysAgo: 0, ease: 3, type: 0, ivl: -600 });
  } else {
    steps.push({ daysAgo: 30, ease: 3, type: 0, ivl: -600 });
    steps.push({ daysAgo: 29, ease: 3, type: 0, ivl: 1 });
    steps.push({ daysAgo: 25, ease: 3, type: 1, ivl: 4 });
    if (n.noteId % 3 === 0) {
      steps.push({ daysAgo: 18, ease: 1, type: 1, ivl: 0 }); // forgot it
      steps.push({ daysAgo: 18, ease: 3, type: 2, ivl: -600 }); // relearn
      steps.push({ daysAgo: 17, ease: 3, type: 2, ivl: 3 });
      steps.push({ daysAgo: 9, ease: 3, type: 1, ivl: 7 });
      steps.push({ daysAgo: 2, ease: 4, type: 1, ivl: 15 });
    } else {
      steps.push({ daysAgo: 16, ease: 3, type: 1, ivl: 9 });
      steps.push({ daysAgo: 5, ease: 4, type: 1, ivl: 22 });
    }
  }

  let factor = 2500;
  return steps.map((s, i) => {
    if (s.ease === 1) factor = Math.max(1300, factor - 200);
    else if (s.ease === 4) factor += 150;
    return {
      id: DEMO_NOW - s.daysAgo * DAY_MS + i * 1000, // +i keeps ids strictly rising
      usn: 1,
      ease: s.ease,
      ivl: s.ivl,
      lastIvl: i > 0 ? steps[i - 1].ivl : 0,
      factor,
      time: 3000 + (n.noteId % 5) * 800,
      type: s.type,
    };
  });
};

// The current scheduling state, kept consistent with the synthesized log above
// (interval/reps/lapses/factor all read off it) so cardsInfo and the review
// history never disagree in the panel.
const demoSchedule = (n: DemoNote) => {
  const reviews = demoReviews(n);
  const last = reviews[reviews.length - 1];
  const type = n.state === "new" ? 0 : n.state === "learn" ? 1 : 2;
  return {
    ord: 0,
    type,
    queue: n.suspended ? -1 : type,
    interval: last && last.ivl > 0 ? last.ivl : 0,
    reps: reviews.length,
    lapses: reviews.filter((r) => r.ease === 1).length,
    factor: last ? last.factor : 0,
  };
};

// --- Collection-wide review log --------------------------------------------
//
// `cardReviews` returns raw positional rows, and the Stats section folds its
// whole page out of them: a rolling-year heatmap, streaks, lifetime totals,
// true retention and the answer-time median. demoReviews above can't serve
// that — it covers one card over a few weeks, so a year heatmap built on it
// would be a dozen scattered squares and every lifetime total would equal the
// note count.
//
// So this synthesises a plausible year instead: a study calendar with a weekly
// rest day and one holiday gap, and per-card interval ladders snapped onto it.
// Everything derives from the note id rather than a loop index or RNG, so a
// note reached through both a deck and its subdeck yields identical rows that
// dedupe cleanly, and the demo looks the same on every visit.

/** How far back the demo collection's history runs. */
const HISTORY_DAYS = 400;

/**
 * Whether the demo user studied `daysAgo` days before today: a steady habit
 * with scattered rest days and one holiday, so the heatmap isn't a solid block.
 *
 * Rest days are scattered by a multiplicative hash rather than a fixed period.
 * `daysAgo % 9 !== 4` would rest every ninth day exactly, which caps the
 * longest streak at eight and makes the tile look like what it is — generated.
 * Irregular gaps give runs of varying length, the way a real habit does.
 *
 * The last three weeks are unbroken so a visitor arrives mid-streak.
 */
function isDemoStudyDay(daysAgo: number): boolean {
  if (daysAgo > HISTORY_DAYS) return false;
  if (daysAgo < 21) return true;
  if (daysAgo >= 250 && daysAgo <= 263) return false; // a holiday
  if (daysAgo >= 300 && daysAgo <= 360) return true; // a focused stretch
  return (daysAgo * 2_654_435_761) % 100 >= 8; // ~8% rest days
}

/** The nearest study day at or after `daysAgo` (i.e. shifted toward today). */
function snapToStudyDay(daysAgo: number): number {
  let d = daysAgo;
  while (d > 0 && !isDemoStudyDay(d)) d--;
  return d;
}

/**
 * Local midnight `daysAgo` days before `nowMs`. Calendar arithmetic, not
 * ms subtraction: a DST boundary makes a local day 23 or 25 hours long, which
 * would smear synthesised reviews into the neighbouring day and put a visible
 * seam in the demo's heatmap.
 */
function demoDayStart(nowMs: number, daysAgo: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// A card's interval ladder in days. Index 0 is the learning step; the rest are
// review intervals, deliberately spanning Anki's 21-day young/mature boundary
// so the retention split has both buckets to report.
const DEMO_INTERVALS = [0, 1, 3, 7, 16, 35, 70, 140];
const DEMO_EASES = [3, 3, 4, 3, 2, 3, 1, 4, 3, 3]; // mostly passes, a few misses

/**
 * Positional revlog rows for `notes`, oldest first:
 * [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type].
 *
 * Durations sit either side of DEMO_STATS.secondsPerCard so its median still
 * lands on it — the "N cards in ~M min" footer stays honest while the Stats
 * page's answer-time median has real spread to work with.
 */
function demoRevlog(notes: DemoNote[], nowMs: number): number[][] {
  const rows: number[][] = [];

  const push = (
    n: DemoNote,
    daysAgo: number,
    seq: number,
    ease: number,
    ivl: number,
    lastIvl: number,
    factor: number,
    type: number,
  ) =>
    rows.push([
      // Spread within the day so ids stay unique per note while remaining
      // safely inside their own calendar day.
      demoDayStart(nowMs, daysAgo) + (n.noteId % 20_000) * 1000 + seq,
      cardIdOf(n.noteId),
      1,
      ease,
      ivl,
      lastIvl,
      factor,
      DEMO_STATS.secondsPerCard * 1000 + ((n.noteId % 5) - 2) * 400,
      type,
    ]);

  for (const n of notes) {
    if (n.state === "new") continue;
    // When this card entered the collection, stable per note.
    const introducedDaysAgo = HISTORY_DAYS - (n.noteId % (HISTORY_DAYS - 20));
    let factor = 2500;
    let rung = 0;

    for (let i = 0; i < DEMO_INTERVALS.length; i++) {
      const target = introducedDaysAgo - DEMO_INTERVALS[i];
      if (target < 0) break;
      const ease = DEMO_EASES[(n.noteId + i) % DEMO_EASES.length];
      if (ease === 1) factor = Math.max(1300, factor - 200);
      else if (ease === 4) factor += 150;
      // Index 0 is the learning step; everything after it is a scheduled review.
      push(
        n,
        snapToStudyDay(target),
        i,
        ease,
        DEMO_INTERVALS[i],
        i === 0 ? 0 : DEMO_INTERVALS[i - 1],
        factor,
        i === 0 ? 0 : 1,
      );
      rung = i;
    }

    // A card's ladder rarely lands exactly on today, so without this the demo
    // could open with an empty heatmap square and a zeroed streak. Give a
    // deterministic quarter of the collection a review today.
    if (rung > 0 && n.noteId % 4 === 0) {
      const ivl = DEMO_INTERVALS[rung];
      push(n, 0, DEMO_INTERVALS.length, 3, ivl * 2, ivl, factor, 1);
    }
  }

  return rows.sort((a, b) => a[0] - b[0]);
}

// --- The archive -----------------------------------------------------------
//
// The fixture collection is 25 browsable notes, and 20 of them are new — so the
// ladders above produce a history for four cards. That's fine for the per-note
// stats panel, and hopeless for the Stats page: a rolling-year heatmap drawn
// from four cards is a handful of scattered squares, and it would tell a
// visitor the product has nothing to show.
//
// Real collections don't look like that. A user's year of study is mostly
// cards they long ago stopped thinking about, vastly outnumbering what's in
// front of them today. So the revlog also carries an "archive": reviews of
// cards that aren't in the fixture note set at all, at the daily pace the demo
// already advertises (DEMO_STATS.studiedTodayCards).
//
// Nothing dereferences these card ids — the Stats pipeline only counts distinct
// ones — and they're numbered above every real fixture card so they can't
// collide. The rest of the demo is unaffected: the deck list, study flow and
// note stats all still read from NOTES alone.

/** Synthetic card ids sit above every fixture card (CARD_OFFSET + note id). */
const ARCHIVE_CARD_BASE = 900_000;
const ARCHIVE_CARDS = 600;

/** Prior intervals for archive reviews, spanning the 21-day maturity boundary. */
const ARCHIVE_INTERVALS = [1, 3, 7, 16, 35, 70, 140, 210];

/**
 * Which deck each archive card belongs to. Snapshotted from the fixtures at
 * load rather than read from DECKS live, so creating a deck mid-session doesn't
 * reshuffle a year of history under the visitor.
 */
const ARCHIVE_DECKS = [...new Set(NOTES.map((n) => n.deckName))];

/**
 * Archive rows for the decks under `deck`. Deterministic in the day and index,
 * so every visit shows the same year and a note fetched under both a deck and
 * its parent yields identical rows that dedupe on id.
 */
/**
 * The fixture note an archive card stands in for, chosen from the same deck
 * the card's reviews are attributed to (demoArchiveRevlog assigns decks by
 * `card % ARCHIVE_DECKS.length`, so the note must come from that same deck or
 * a Trouble Spots row would link to a deck that doesn't contain it).
 */
function archiveNoteOf(cardId: number): DemoNote | null {
  const card = cardId - ARCHIVE_CARD_BASE;
  if (card < 0 || card >= ARCHIVE_CARDS) return null;
  const deck = ARCHIVE_DECKS[card % ARCHIVE_DECKS.length];
  const inDeck = NOTES.filter((n) => n.deckName === deck);
  return inDeck.length ? inDeck[card % inDeck.length] : null;
}

function demoArchiveRevlog(deck: string, nowMs: number): number[][] {
  if (ARCHIVE_DECKS.length === 0) return [];
  const rows: number[][] = [];

  for (let daysAgo = 0; daysAgo <= HISTORY_DAYS; daysAgo++) {
    if (!isDemoStudyDay(daysAgo)) continue;
    // Vary the day's volume around the advertised pace so the heatmap has
    // light and heavy days rather than one flat colour.
    const count =
      DEMO_STATS.studiedTodayCards + ((daysAgo * 7) % 13) - 6;

    for (let i = 0; i < count; i++) {
      const card = (daysAgo * 37 + i * 11) % ARCHIVE_CARDS;
      // Own cards only, for the same reason as the fixture rows above: an
      // archive card belongs to exactly one deck, and claiming it for every
      // ancestor would break every deck filter.
      if (ARCHIVE_DECKS[card % ARCHIVE_DECKS.length] !== deck) continue;

      // Every fifth answer is a learning step: a new card being introduced,
      // which retention must exclude and the activity charts must still count.
      const isLearning = (daysAgo + i) % 5 === 0;
      const lastIvl = ARCHIVE_INTERVALS[(daysAgo + i) % ARCHIVE_INTERVALS.length];
      rows.push([
        // Offset well clear of the fixture-note rows, which sit in the first
        // few seconds of each day.
        demoDayStart(nowMs, daysAgo) + 30_000_000 + i * 1000,
        ARCHIVE_CARD_BASE + card,
        1,
        DEMO_EASES[(daysAgo + i) % DEMO_EASES.length],
        isLearning ? 0 : lastIvl * 2,
        isLearning ? 0 : lastIvl,
        2500 + ((card % 7) - 3) * 100,
        DEMO_STATS.secondsPerCard * 1000 + ((i % 5) - 2) * 400,
        isLearning ? 0 : 1,
      ]);
    }
  }

  return rows;
}

// --- Forecast --------------------------------------------------------------
//
// The Stats page asks "how many cards fall due N days from now?" as a
// `prop:due` search, one per day. The demo's query evaluator can't answer that
// (it has no scheduling model), and even if it could, 20 of the 25 fixture
// notes are new — a faithful answer is a chart of near-zeros.
//
// So, like the archive above, this answers at the pace the demo advertises.
// Only the id *count* is ever read (fetchForecastCounts takes .length), so the
// ids themselves need only be plausible and collision-free.

const FORECAST_QUERY = /prop:due(?:<=|=)(-?\d+)/;

/** Ids for a forecast query, or null when this isn't one. */
function demoForecastIds(query: string): number[] | null {
  const match = query.match(FORECAST_QUERY);
  if (!match) return null;

  const dayOffset = Number(match[1]);
  const deck = query.match(/deck:"([^"]+)"/)?.[1];
  // Day 0 carries the overdue backlog too, so it's the heaviest of the month.
  const base =
    dayOffset <= 0
      ? DEMO_STATS.studiedTodayCards + 6
      : 7 + ((dayOffset * 11) % 16);
  // Scale a deck-scoped query by that deck's share, so per-deck forecasts add
  // up to roughly the collection's.
  const share = deck
    ? notesInSubtree(deck).length / Math.max(1, NOTES.length)
    : 1;

  const count = Math.round(base * share);
  return Array.from(
    { length: count },
    (_, i) => ARCHIVE_CARD_BASE + ARCHIVE_CARDS + dayOffset * 100 + i,
  );
}

// AnkiConnect's cardsInfo shape (the fields the app actually reads).
const cardInfo = (cardId: number) => {
  // Archive cards (see demoArchiveRevlog) have no fixture notes of their own;
  // resolve each to a real note in ITS deck so anything that looks one up —
  // the Stats "Trouble spots" list resolves its top lapsers this way — shows
  // real content and links to a deck that actually holds it. Deterministic in
  // the card id, like everything else the archive derives.
  const n =
    cardId >= ARCHIVE_CARD_BASE
      ? archiveNoteOf(cardId)
      : findNote(noteIdOfCard(cardId));
  if (!n) return null;
  return {
    cardId,
    note: n.noteId,
    noteId: n.noteId,
    deckName: n.deckName,
    modelName: n.modelName,
    fields: fieldsOf(n),
    question: questionHtml(n),
    answer: answerHtml(n),
    ...demoSchedule(n),
  };
};

// ---------------------------------------------------------------------------
// Reviewer simulation. Anki's GUI review actions are stateful: guiDeckReview
// starts a session for a deck (subtree-inclusive), guiCurrentCard serves the
// card on top of the queue, and grading advances it. We hold that queue here.
// ---------------------------------------------------------------------------

const review = {
  deck: null as string | null,
  queue: [] as number[], // cardIds still to review, in order
  idx: 0, // pointer to the current card
  answerShown: false,
  // Notes graded this session, with their pre-grade state, so undo can restore
  // them. Grading marks a note "done" (dropping it from due counts), which is
  // how a finished deck disappears from the home page — just like the real app.
  graded: [] as { noteId: number; prevState: DemoNote["state"] }[],
};

const buildQueue = (root: string) =>
  notesInSubtree(root)
    .filter(isDue)
    .map((n) => cardIdOf(n.noteId));

const guiCurrentCard = () => {
  if (review.idx >= review.queue.length) return null;
  const cardId = review.queue[review.idx];
  const n = findNote(noteIdOfCard(cardId));
  if (!n) return null;
  return {
    cardId,
    question: questionHtml(n),
    answer: answerHtml(n),
    deckName: n.deckName,
    fields: fieldsOf(n),
  };
};

// ---------------------------------------------------------------------------
// The dispatcher. Mirrors ankiFetch's contract: resolve with the `result`, or
// throw to mimic an AnkiConnect error. A short delay makes loading states and
// fade transitions read naturally rather than snapping instantly.
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Actions that change the in-memory model; after any of these we snapshot to
// sessionStorage so the change survives a page reload (see persistDemoState).
const MUTATING = new Set([
  "guiAnswerCard",
  "guiUndo",
  "suspend",
  "unsuspend",
  "forgetCards",
  "setSpecificValueOfCard",
  "addNote",
  "updateNoteFields",
  "updateNote",
  "deleteNotes",
  "addTags",
  "removeTags",
  "changeDeck",
  "createDeck",
  "deleteDecks",
  "storeMediaFile",
]);

export async function mockAnki(
  action: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  await wait(action.startsWith("gui") ? 40 : 90);
  const result = await handleAction(action, params);
  if (MUTATING.has(action)) persistDemoState();
  return result;
}

async function handleAction(
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case "deckNames":
      return DECKS.map((d) => d.name);

    case "deckNamesAndIds":
      return Object.fromEntries(DECKS.map((d) => [d.name, d.id]));

    case "getDeckStats": {
      const decks = (params.decks as string[]) ?? [];
      const out: Record<string, unknown> = {};
      for (const name of decks) {
        const due = notesInSubtree(name).filter(isDue);
        out[String(deckId(name))] = {
          deck_id: deckId(name),
          name,
          new_count: due.filter((n) => n.state === "new").length,
          learn_count: due.filter((n) => n.state === "learn").length,
          review_count: due.filter((n) => n.state === "review").length,
          total_in_deck: notesInSubtree(name).length,
        };
      }
      return out;
    }

    case "getNumCardsReviewedToday":
      return DEMO_STATS.studiedTodayCards;

    case "cardReviews": {
      const deck = params.deck as string;
      const startID = (params.startID as number) ?? 0;
      const now = Date.now();
      // A deck's OWN cards only — NOT its subtree. Real AnkiConnect works this
      // way (which is why fetchCollectionRevlog fans out over every deck), and
      // the difference is not cosmetic: the fan-out tags each row with the deck
      // it came back under and dedupes on first occurrence, so returning the
      // subtree here would tag a subdeck's rows with its parent and make every
      // narrower filter come back empty.
      const own = NOTES.filter((n) => n.deckName === deck);
      return [...demoRevlog(own, now), ...demoArchiveRevlog(deck, now)]
        .filter((r) => r[0] >= startID)
        .sort((a, b) => a[0] - b[0]);
    }

    case "findNotes": {
      // Evaluate the query so operator searches (tag:, is:, note:, negation, …)
      // actually filter. A plain `deck:"X"` still returns the whole subtree,
      // suspended notes included — the deck detail list marks them, not hides
      // them — because deck: alone doesn't constrain state.
      return notesMatchingSearch(NOTES, params.query as string).map(
        (n) => n.noteId,
      );
    }

    case "multi": {
      // AnkiConnect's request batcher: run each sub-action and return their
      // results positionally. The Stats forecast uses it to ask 30 due-date
      // searches in one round trip instead of 30, which is the difference
      // between a page that appears and a page that crawls in.
      const actions =
        (params.actions as { action: string; params?: Record<string, unknown> }[]) ??
        [];
      // Each sub-action gets its OWN {result, error} envelope, exactly like a
      // top-level response — verified against a live AnkiConnect. Returning
      // bare results here would be a mock that's easier to consume than the
      // real thing, which is the kind that lets a bug ship green.
      return Promise.all(
        actions.map(async (a) => {
          try {
            return { result: await handleAction(a.action, a.params ?? {}), error: null };
          } catch (e) {
            return { result: null, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
    }

    case "findCards": {
      const query = params.query as string;
      // The Stats forecast is a scheduling question the fixtures can't answer
      // (see demoForecastIds); everything else goes to the query evaluator.
      const forecast = demoForecastIds(query);
      if (forecast) return forecast;
      // The evaluator honours the `-deck:"X::*"` exclusion a rename uses to
      // grab only a deck's OWN cards, without which moving a deck with subdecks
      // would flatten them.
      return notesMatchingSearch(NOTES, query).map((n) => cardIdOf(n.noteId));
    }

    case "notesInfo": {
      const ids = (params.notes as number[]) ?? [];
      return ids.map(findNote).filter(Boolean).map((n) => noteInfo(n!));
    }

    case "cardsInfo": {
      const ids = (params.cards as number[]) ?? [];
      return ids.map(cardInfo).filter(Boolean);
    }

    case "getReviewsOfCards": {
      // { cardId(as string): [{ id, usn, ease, ivl, lastIvl, factor, time, type }] }.
      // Drives the per-note stats panel's history charts.
      const ids = (params.cards as number[]) ?? [];
      const out: Record<string, CardReview[]> = {};
      for (const cardId of ids) {
        const n = findNote(noteIdOfCard(cardId));
        out[String(cardId)] = n ? demoReviews(n) : [];
      }
      return out;
    }

    case "getDecks": {
      // cardIds grouped by the deck that holds them: { deckName: [cardId, …] }.
      const ids = (params.cards as number[]) ?? [];
      const out: Record<string, number[]> = {};
      for (const cardId of ids) {
        const n = findNote(noteIdOfCard(cardId));
        if (n) (out[n.deckName] ??= []).push(cardId);
      }
      return out;
    }

    case "areSuspended": {
      // One flag per input card, in order; null for cards that don't exist.
      const ids = (params.cards as number[]) ?? [];
      return ids.map(
        (cardId) => findNote(noteIdOfCard(cardId))?.suspended ?? null,
      );
    }

    case "getTags":
      return [...new Set(NOTES.flatMap((n) => n.tags))].sort();

    // --- Reviewer protocol ---------------------------------------------------
    case "guiDeckReview": {
      const name = params.name as string;
      // Re-entering the same deck mid-session preserves progress: the queue and
      // pointer already reflect every grade/suspend/undo done so far, so we just
      // clear the shown-answer flag. A different deck (session start, or the
      // next deck of a scoped multi-deck session) builds a fresh queue.
      if (review.deck !== name) {
        review.deck = name;
        review.queue = buildQueue(name);
        review.idx = 0;
        review.graded = [];
      }
      review.answerShown = false;
      return true;
    }

    case "guiCurrentCard":
      return guiCurrentCard();

    case "guiStartCardTimer":
      return true;

    case "guiShowAnswer":
      review.answerShown = true;
      return true;

    case "guiAnswerCard": {
      // Mark the graded note "done" so it leaves the due counts — that's how a
      // finished deck drops off the home page. Record the prior state for undo.
      // We don't requeue "Fail" so a demo session always reaches completion.
      const graded = findNote(noteIdOfCard(review.queue[review.idx]));
      if (graded) {
        review.graded.push({ noteId: graded.noteId, prevState: graded.state });
        graded.state = "done";
      }
      review.idx += 1;
      review.answerShown = false;
      return true;
    }

    case "guiUndo":
      if (review.idx > 0) {
        review.idx -= 1;
        const last = review.graded.pop();
        const n = last && findNote(last.noteId);
        if (n && last) n.state = last.prevState; // bring the card back as due
        review.answerShown = false;
      }
      return true;

    case "reloadCollection":
      return null;

    case "suspend": {
      const cards = (params.cards as number[]) ?? [];
      for (const cardId of cards) {
        const n = findNote(noteIdOfCard(cardId));
        if (n) n.suspended = true;
        const qi = review.queue.indexOf(cardId);
        if (qi >= 0) {
          review.queue.splice(qi, 1);
          if (qi < review.idx) review.idx -= 1;
        }
      }
      return true;
    }

    case "unsuspend": {
      // The card becomes due again but doesn't rejoin an in-flight queue —
      // like real Anki, it only shows up after the next guiDeckReview rebuild.
      const cards = (params.cards as number[]) ?? [];
      for (const cardId of cards) {
        const n = findNote(noteIdOfCard(cardId));
        if (n) n.suspended = false;
      }
      return true;
    }

    // Anki's Forget: back to the new queue, which also clears suspension. The
    // mock has no scheduling state to wipe beyond that, so unsuspending is the
    // whole of it here.
    case "forgetCards": {
      const cards = (params.cards as number[]) ?? [];
      for (const cardId of cards) {
        const n = findNote(noteIdOfCard(cardId));
        if (n) n.suspended = false;
      }
      return null;
    }

    case "setSpecificValueOfCard": {
      // The app uses this only to write a card's `flags` column (see lib/flags).
      // One boolean per key, like AnkiConnect; the demo is note-level so the
      // flag lands on the note behind the card.
      const n = findNote(noteIdOfCard(params.card as number));
      const keys = (params.keys as string[]) ?? [];
      const newValues = (params.newValues as string[]) ?? [];
      keys.forEach((key, i) => {
        if (n && key === "flags") n.flag = Number(newValues[i]) || 0;
      });
      return keys.map(() => true);
    }

    case "sync":
      await wait(600); // a beat, so the completion screen shows its sync state
      return null;

    // --- Writes from the add/edit forms -------------------------------------
    case "addNote": {
      const p = (params.note as Record<string, unknown>) ?? {};
      const fields = (p.fields as Record<string, string>) ?? {};
      const n = addDemoNote(
        (p.deckName as string) || "Spanish::Vocabulary",
        fields.Front ?? fields.Text ?? "New card",
        fields.Back ?? "",
        "new",
        (p.tags as string[]) ?? [],
      );
      // If a session is open on a deck that contains the new card, let it join
      // the queue so "Add note" mid-study behaves like the real app.
      if (review.deck && isCardInDeck(n.deckName, review.deck)) {
        review.queue.push(cardIdOf(n.noteId));
      }
      return n.noteId;
    }

    case "updateNoteFields": {
      const p = (params.note as Record<string, unknown>) ?? {};
      const n = findNote(p.id as number);
      if (n) {
        const fields = (p.fields as Record<string, string>) ?? {};
        if (fields.Front != null) n.front = fields.Front;
        if (fields.Back != null) n.back = fields.Back;
      }
      return null;
    }

    case "updateNote": {
      // Combines updateNoteFields with a wholesale tag replacement, matching
      // AnkiConnect: fields and/or tags, whichever the payload carries.
      const p = (params.note as Record<string, unknown>) ?? {};
      const n = findNote(p.id as number);
      if (n) {
        const fields = (p.fields as Record<string, string>) ?? {};
        if (fields.Front != null) n.front = fields.Front;
        if (fields.Back != null) n.back = fields.Back;
        if (Array.isArray(p.tags)) n.tags = [...new Set(p.tags as string[])];
      }
      return null;
    }

    case "deleteNotes": {
      const ids = new Set((params.notes as number[]) ?? []);
      for (let i = NOTES.length - 1; i >= 0; i--) {
        if (ids.has(NOTES[i].noteId)) NOTES.splice(i, 1);
      }
      return null;
    }

    case "addTags": {
      const ids = new Set((params.notes as number[]) ?? []);
      const tags = String(params.tags ?? "").split(" ").filter(Boolean);
      for (const n of NOTES) if (ids.has(n.noteId)) n.tags = [...new Set([...n.tags, ...tags])];
      return null;
    }

    case "removeTags": {
      const ids = new Set((params.notes as number[]) ?? []);
      const tags = new Set(String(params.tags ?? "").split(" ").filter(Boolean));
      for (const n of NOTES) if (ids.has(n.noteId)) n.tags = n.tags.filter((t) => !tags.has(t));
      return null;
    }

    case "changeDeck": {
      const cards = (params.cards as number[]) ?? [];
      const deck = params.deck as string;
      for (const cardId of cards) {
        const n = findNote(noteIdOfCard(cardId));
        if (n) n.deckName = deck;
      }
      return null;
    }

    // --- Model / deck config the forms probe; stock answers keep them happy ---
    case "modelNames":
      return ["Basic", "Basic (and reversed card)", "Cloze"];
    case "createDeck":
      // Register the deck so it shows up on the deck list — e.g. importing a
      // deck, or adding a note to a brand-new deck.
      ensureDeck(params.deck as string);
      return deckId(params.deck as string) || 999;
    case "getDeckConfig":
      return { id: 1, name: "Default" };

    // --- Secondary flows (settings, media, model templates). The demo doesn't
    // showcase these, but stubbing them keeps the app from ever hitting the
    // default warning and is enforced by the mock⇄app contract test, so every
    // action the app can call is accounted for here on purpose. ---
    case "createModel":
    case "updateModelTemplates":
    case "saveDeckConfig":
    case "setDeckConfigId":
      return null;

    case "deleteDecks": {
      // Remove each named deck and its subtree from the registry. renameDeck
      // relies on this to clear the emptied originals after moving cards out;
      // without it the source deck lingers as an empty "0 card" copy. cardsToo
      // mirrors Anki 2.1.28+ (a delete always takes contained cards with it).
      const decks = (params.decks as string[]) ?? [];
      const cardsToo = params.cardsToo === true;
      for (const name of decks) {
        if (cardsToo) {
          for (let i = NOTES.length - 1; i >= 0; i--) {
            if (isCardInDeck(NOTES[i].deckName, name)) NOTES.splice(i, 1);
          }
        }
        removeDeckSubtree(name);
      }
      return null;
    }
    case "storeMediaFile": {
      // Keep the uploaded bytes so the image/audio can be rendered back below.
      const filename = (params.filename as string) ?? "media";
      if (typeof params.data === "string") DEMO_MEDIA.set(filename, params.data);
      return filename;
    }
    case "retrieveMediaFile":
      return DEMO_MEDIA.get(params.filename as string) ?? false;

    case "getMediaFilesNames": {
      // AnkiConnect returns the collection-media filenames matching the glob
      // `pattern` (defaulting to "*"). The demo's media lives in DEMO_MEDIA,
      // filled as the user pastes images/audio, so glob-match its keys. The
      // media indicators look a referenced file up by its exact name, so an
      // added file reads as present and a stale reference reads as missing.
      const pattern = (params.pattern as string) ?? "*";
      const re = new RegExp(
        "^" +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$"
      );
      return [...DEMO_MEDIA.keys()].filter((name) => re.test(name));
    }

    default:
      // Anything we didn't model returns an empty-ish value so the UI degrades
      // gracefully instead of throwing. Surfaced in the console for tuning.
      console.warn(`[demo] unhandled AnkiConnect action: ${action}`, params);
      return null;
  }
}
