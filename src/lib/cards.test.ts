import { describe, it, expect, vi } from "vitest";
import {
  areSuspended,
  cardState,
  fetchCardState,
  setSuspended,
} from "./cards";
import { mockAnki } from "./demo/mock-anki";
import type { CardInfo } from "./types";

// Run the typed layer against the demo mock, so setSuspended's suspend /
// unsuspend split is checked against the same simulator the demo build uses
// (which is also what guards the mock's "unsuspend" case from regressing).
vi.mock("./anki-fetch", () => ({
  ankiFetch: (action: string, params?: Record<string, unknown>) =>
    import("./demo/mock-anki").then(({ mockAnki }) => mockAnki(action, params)),
}));

// The mock derives cardId from noteId with a fixed offset (see mock-anki.ts).
const CARD_OFFSET = 100_000;

// A minimal CardInfo; tests override only the scheduling fields they exercise.
const card = (over: Partial<CardInfo>): CardInfo => ({
  cardId: 1,
  deckName: "D",
  fields: {},
  question: "",
  answer: "",
  ...over,
});

describe("cardState", () => {
  it("names the state from `type`, defaulting an unscheduled card to new", () => {
    expect(cardState(card({ type: 0, queue: 0 }))).toBe("new");
    expect(cardState(card({ type: 1, queue: 1 }))).toBe("learning");
    expect(cardState(card({ type: 2, queue: 2 }))).toBe("review");
    expect(cardState(card({ type: 3, queue: 1 }))).toBe("relearning");
    // No type/queue at all (some AnkiConnect reads omit them) → new.
    expect(cardState(card({}))).toBe("new");
  });

  it("treats queue -1 as suspended, whatever the type", () => {
    expect(cardState(card({ type: 2, queue: -1 }))).toBe("suspended");
  });
});

describe("fetchCardState", () => {
  it("reports a freshly added card as new, and null for an unknown card", async () => {
    const noteId = (await mockAnki("addNote", {
      note: {
        deckName: "StateTest",
        fields: { Front: "f", Back: "b" },
        tags: [],
      },
    })) as number;

    expect(await fetchCardState(CARD_OFFSET + noteId)).toBe("new");
    expect(await fetchCardState(999_999_999)).toBeNull();
  });
});

describe("setSuspended", () => {
  it("suspends and unsuspends cards, round-tripping through areSuspended", async () => {
    const noteId = (await mockAnki("addNote", {
      note: {
        deckName: "SuspendTest",
        fields: { Front: "f", Back: "b" },
        tags: [],
      },
    })) as number;
    const cardId = CARD_OFFSET + noteId;

    await setSuspended([cardId], true);
    expect(await areSuspended([cardId])).toEqual([true]);

    await setSuspended([cardId], false);
    expect(await areSuspended([cardId])).toEqual([false]);
  });
});
