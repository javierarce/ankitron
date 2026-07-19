import { describe, it, expect, vi } from "vitest";
import { mockAnki } from "./demo/mock-anki";
import {
  computeNoteStats,
  fetchNoteStats,
  noteCreationTime,
} from "./note-stats";
import type { CardInfo, CardReview } from "./types";

// Exercise the transport layer against the demo mock, which models the real
// cardsInfo / getReviewsOfCards shapes (see review.test.ts for the pattern).
vi.mock("./anki-fetch", () => ({
  ankiFetch: (action: string, params?: Record<string, unknown>) =>
    import("./demo/mock-anki").then(({ mockAnki }) => mockAnki(action, params)),
}));

const CARD_OFFSET = 100_000; // mock derives cardId from noteId (see mock-anki.ts)

// A minimal cardsInfo row; scheduling fields default to a fresh review card.
function card(cardId: number, over: Partial<CardInfo> = {}): CardInfo {
  return {
    cardId,
    deckName: "Test",
    fields: {},
    question: "",
    answer: "",
    ord: 0,
    type: 2,
    queue: 2,
    interval: 10,
    reps: 0,
    lapses: 0,
    factor: 2500,
    ...over,
  };
}

function review(over: Partial<CardReview> = {}): CardReview {
  return {
    id: 1_700_000_000_000,
    usn: 1,
    ease: 3,
    ivl: 4,
    lastIvl: 1,
    factor: 2500,
    time: 5000,
    type: 1,
    ...over,
  };
}

describe("noteCreationTime", () => {
  it("reads a real note id as its epoch-ms creation time", () => {
    expect(noteCreationTime(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("returns null for the demo's small sequential ids", () => {
    expect(noteCreationTime(42)).toBeNull();
  });
});

describe("computeNoteStats", () => {
  it("returns an empty-but-valid summary for a never-studied note", () => {
    const stats = computeNoteStats(
      { noteId: 5, tags: [] },
      [card(CARD_OFFSET + 5, { type: 0, queue: 0, interval: 0, factor: 0 })],
      {},
    );

    expect(stats.totalReviews).toBe(0);
    expect(stats.successRate).toBeNull();
    expect(stats.firstReviewedAt).toBeNull();
    expect(stats.cards[0].state).toBe("new");
    expect(stats.cards[0].easePercent).toBeNull();
  });

  it("aggregates reviews, lapses, time, and success rate across the log", () => {
    const cardId = CARD_OFFSET + 1;
    const reviews = [
      review({ id: 100, ease: 3, time: 4000, type: 1 }),
      review({ id: 300, ease: 1, time: 6000, type: 1 }), // a failure
      review({ id: 200, ease: 4, time: 2000, type: 1 }),
    ];
    const stats = computeNoteStats(
      { noteId: 1, tags: [] },
      [card(cardId, { lapses: 1, factor: 2300 })],
      { [cardId]: reviews },
    );

    expect(stats.totalReviews).toBe(3);
    expect(stats.totalLapses).toBe(1);
    expect(stats.totalTimeMs).toBe(12000);
    expect(stats.gradeCounts).toEqual({ again: 1, hard: 0, good: 1, easy: 1 });
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.firstReviewedAt).toBe(100);
    expect(stats.lastReviewedAt).toBe(300);
    // Reviews come back sorted oldest-first regardless of input order.
    expect(stats.cards[0].reviews.map((r) => r.id)).toEqual([100, 200, 300]);
    expect(stats.cards[0].easePercent).toBe(230);
  });

  it("ignores manual reschedule rows (ease 0: Forget / Set Due Date)", () => {
    const cardId = CARD_OFFSET + 1;
    const reviews = [
      review({ id: 100, ease: 3, time: 4000, type: 1 }),
      review({ id: 200, ease: 0, time: 0, type: 4 }), // manual Set Due Date
      review({ id: 300, ease: 4, time: 2000, type: 1 }),
    ];
    const stats = computeNoteStats(
      { noteId: 1, tags: [] },
      [card(cardId)],
      { [cardId]: reviews },
    );

    // The manual row is dropped everywhere: total, success rate, grade counts,
    // time, and the chart dots (no blank "?" ease-0 dot).
    expect(stats.totalReviews).toBe(2);
    expect(stats.successRate).toBe(1);
    expect(stats.gradeCounts).toEqual({ again: 0, hard: 0, good: 1, easy: 1 });
    expect(stats.totalTimeMs).toBe(6000);
    expect(stats.cards[0].reviews.map((r) => r.ease)).toEqual([3, 4]);
  });

  it("flags a leech from the note's tags", () => {
    const stats = computeNoteStats({ noteId: 1, tags: ["leech", "spanish"] }, [], {});
    expect(stats.isLeech).toBe(true);
  });

  it("orders cards by template ord and takes the furthest interval", () => {
    const stats = computeNoteStats(
      { noteId: 1, tags: [] },
      [
        card(11, { ord: 1, interval: 30 }),
        card(10, { ord: 0, interval: 12 }),
      ],
      {},
    );

    expect(stats.cards.map((c) => c.cardId)).toEqual([10, 11]);
    expect(stats.intervalDays).toBe(30);
  });

  it("falls back to the last review's ease when cardsInfo omits a factor", () => {
    const cardId = 10;
    const stats = computeNoteStats(
      { noteId: 1, tags: [] },
      [card(cardId, { factor: 0 })],
      { [cardId]: [review({ factor: 1800 })] },
    );
    expect(stats.cards[0].easePercent).toBe(180);
  });
});

describe("fetchNoteStats (over the demo mock)", () => {
  // Discover a note the demo has actually studied, rather than hard-coding an
  // id that shifts with fixture load order.
  async function findStudiedNoteId(): Promise<number> {
    const ids = (await mockAnki("findNotes", { query: "deck:*" })) as number[];
    for (const id of ids) {
      const [info] = (await mockAnki("cardsInfo", {
        cards: [CARD_OFFSET + id],
      })) as { reps: number }[];
      if (info && info.reps > 0) return id;
    }
    throw new Error("no studied note in the demo fixtures");
  }

  it("pulls and shapes a studied note's history end to end", async () => {
    const noteId = await findStudiedNoteId();
    const stats = await fetchNoteStats({
      noteId,
      tags: [],
      cards: [CARD_OFFSET + noteId],
    });

    expect(stats.totalReviews).toBeGreaterThan(0);
    expect(stats.successRate).not.toBeNull();
    expect(stats.firstReviewedAt).not.toBeNull();
    // cardsInfo's interval and the last review's interval stay in lock-step.
    expect(stats.cards[0].reviews.at(-1)?.ivl).toBe(stats.intervalDays);
  });

  it("shapes a freshly added, unstudied note end to end", async () => {
    const noteId = (await mockAnki("addNote", {
      note: { deckName: "StatsTest", fields: { Front: "a", Back: "b" }, tags: [] },
    })) as number;

    const stats = await fetchNoteStats({
      noteId,
      tags: [],
      cards: [CARD_OFFSET + noteId],
    });

    expect(stats.cards).toHaveLength(1);
    expect(stats.cards[0].state).toBe("new");
    expect(stats.totalReviews).toBe(0);
    expect(stats.successRate).toBeNull();
  });
});
