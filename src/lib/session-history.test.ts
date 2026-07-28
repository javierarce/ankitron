import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeDailyAccuracy,
  fetchDeckAccuracyHistory,
} from "./session-history";
import { REVLOG_TYPE, type RevlogEntry } from "./stats/revlog";

// Hoisted so the vi.mock factory below can close over it without a dynamic
// import (an async vi.mock factory that imports deadlocks vitest here).
// session-history reads the revlog through fetchCollectionRevlog, whose
// batched transport (ankiMulti) is mocked here; the envelope handling has its
// own tests in anki-fetch.test.ts.
const { ankiMultiMock } = vi.hoisted(() => ({ ankiMultiMock: vi.fn() }));
vi.mock("./anki-fetch", () => ({
  ankiFetch: vi.fn(),
  ankiMulti: ankiMultiMock,
}));

const DAY = 86_400_000;
// Midday so ±DAY offsets stay within their own calendar day.
const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

const entry = (id: number, ease: number): RevlogEntry => ({
  id,
  cardId: 1,
  ease,
  ivl: 10,
  lastIvl: 5,
  factor: 2500,
  timeMs: 1000,
  type: ease === 0 ? REVLOG_TYPE.manual : REVLOG_TYPE.review,
  deck: "Spanish",
});

/** Raw positional rows, as `cardReviews` returns them through the mock. */
const row = (id: number, ease: number): number[] => [
  id,
  1,
  0,
  ease,
  10,
  5,
  2500,
  1000,
  ease === 0 ? REVLOG_TYPE.manual : REVLOG_TYPE.review,
];

function mockRevlog(rowsByDeck: Record<string, number[][]>) {
  ankiMultiMock.mockImplementation(
    async (actions: { params: { deck: string } }[]) =>
      actions.map((a) => {
        const rows = rowsByDeck[a.params.deck];
        return rows
          ? { ok: true, value: rows }
          : { ok: false, error: "deck gone" };
      }),
  );
}

describe("computeDailyAccuracy", () => {
  it("buckets reviews by day and takes each day's pass rate", () => {
    const entries = [
      entry(now, 3), // today: Good
      entry(now - 60_000, 1), // today: Again
      entry(now - DAY, 4), // yesterday: Easy
      entry(now - 2 * DAY, 2), // 2 days ago: Hard
    ];

    const result = computeDailyAccuracy(entries, 14, now);

    expect(result.map((d) => d.total)).toEqual([1, 1, 2]); // oldest → newest
    // Today: 1 of 2 better than Again.
    expect(result[2].accuracy).toBe(0.5);
    // The single-answer days are all passes.
    expect(result[0].accuracy).toBe(1);
    expect(result[1].accuracy).toBe(1);
  });

  it("skips manual reschedules and dedupes repeated review ids", () => {
    const entries = [
      entry(now, 3),
      entry(now, 3), // duplicate id — must not double-count
      entry(now - 30_000, 0), // manual reschedule (ease 0) — not an answer
    ];

    const result = computeDailyAccuracy(entries, 14, now);

    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
    expect(result[0].accuracy).toBe(1);
  });

  it("drops reviews older than the window", () => {
    const entries = [entry(now, 3), entry(now - 20 * DAY, 1)];

    const result = computeDailyAccuracy(entries, 14, now);

    expect(result).toHaveLength(1);
    expect(result[0].dayMs).toBe(new Date(2026, 5, 15).getTime());
  });
});

describe("fetchDeckAccuracyHistory", () => {
  // mockClear, NOT mockReset: under vitest 4 a reset mock receives its
  // arguments as nulls, so the per-test mockImplementation never sees the deck.
  beforeEach(() => {
    ankiMultiMock.mockClear();
  });

  it("merges every deck's reviews into one trend", async () => {
    mockRevlog({
      Spanish: [row(now, 3)],
      "Spanish::Verbs": [row(now - DAY, 1)],
    });

    const result = await fetchDeckAccuracyHistory(
      ["Spanish", "Spanish::Verbs"],
      14,
      now,
    );

    expect(result).toHaveLength(2);
    expect(result.map((d) => d.total)).toEqual([1, 1]);
  });

  // One unreadable subdeck shouldn't cost the user the whole trend.
  it("tolerates a partial failure and reports the decks it could read", async () => {
    mockRevlog({ Spanish: [row(now, 3)] }); // Spanish::Verbs → error

    const result = await fetchDeckAccuracyHistory(
      ["Spanish", "Spanish::Verbs"],
      14,
      now,
    );

    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
  });

  // The important one: an all-failed read must not look like "no history".
  // Resolving it to [] would have the summary tell a user with months of
  // reviews to study on another day.
  it("throws when every deck's read fails", async () => {
    mockRevlog({}); // every deck → error

    await expect(
      fetchDeckAccuracyHistory(["Spanish", "Spanish::Verbs"], 14, now),
    ).rejects.toThrow(/could not read review history/i);
  });

  it("resolves empty for an empty deck list rather than throwing", async () => {
    await expect(fetchDeckAccuracyHistory([], 14, now)).resolves.toEqual([]);
    expect(ankiMultiMock).not.toHaveBeenCalled();
  });
});
