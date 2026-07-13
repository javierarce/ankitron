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

// AnkiConnect's cardsInfo shape (the fields the app actually reads).
const cardInfo = (cardId: number) => {
  const n = findNote(noteIdOfCard(cardId));
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
    ord: 0,
    type: 2,
    queue: n.suspended ? -1 : 2,
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
      // [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type].
      // fetchTodayStudyStats only reads index 0 (ordering) and 7 (duration);
      // it keeps the newest N across all decks, so any plausible rows work.
      const deck = params.deck as string;
      const rows = notesInSubtree(deck).map((n, i) => {
        const r = new Array(9).fill(0);
        r[0] = n.noteId * 1000 + i; // a stable, monotonic-ish id for ordering
        r[7] = DEMO_STATS.secondsPerCard * 1000; // → "N cards in ~M min" footer
        return r;
      });
      return rows;
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

    case "findCards": {
      // Same evaluator: it honours the `-deck:"X::*"` exclusion a rename uses to
      // grab only a deck's OWN cards, without which moving a deck with subdecks
      // would flatten them.
      return notesMatchingSearch(NOTES, params.query as string).map((n) =>
        cardIdOf(n.noteId),
      );
    }

    case "notesInfo": {
      const ids = (params.notes as number[]) ?? [];
      return ids.map(findNote).filter(Boolean).map((n) => noteInfo(n!));
    }

    case "cardsInfo": {
      const ids = (params.cards as number[]) ?? [];
      return ids.map(cardInfo).filter(Boolean);
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
