import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeDailyAccuracy,
  fetchDeckAccuracyHistory,
} from "./session-history";

// Hoisted so the vi.mock factory below can close over it without a dynamic
// import (an async vi.mock factory that imports deadlocks vitest here).
const { ankiFetchMock } = vi.hoisted(() => ({ ankiFetchMock: vi.fn() }));
vi.mock("./anki-fetch", () => ({ ankiFetch: ankiFetchMock }));

const DAY = 86_400_000;
// Midday so ±DAY offsets stay within their own calendar day.
const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

// [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type]
const row = (id: number, ease: number): number[] => [
  id,
  1,
  0,
  ease,
  0,
  0,
  0,
  1000,
  ease === 0 ? 4 : 1,
];

describe("computeDailyAccuracy", () => {
  it("buckets reviews by day and takes each day's pass rate", () => {
    const rows = [
      row(now, 3), // today: Good
      row(now - 60_000, 1), // today: Again
      row(now - DAY, 4), // yesterday: Easy
      row(now - 2 * DAY, 2), // 2 days ago: Hard
    ];

    const result = computeDailyAccuracy(rows, 14, now);

    expect(result.map((d) => d.total)).toEqual([1, 1, 2]); // oldest → newest
    // Today: 1 of 2 better than Again.
    expect(result[2].accuracy).toBe(0.5);
    // The single-answer days are all passes.
    expect(result[0].accuracy).toBe(1);
    expect(result[1].accuracy).toBe(1);
  });

  it("skips manual reschedules and dedupes repeated review ids", () => {
    const rows = [
      row(now, 3),
      row(now, 3), // duplicate id — must not double-count
      row(now - 30_000, 0), // manual reschedule (ease 0) — not an answer
    ];

    const result = computeDailyAccuracy(rows, 14, now);

    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
    expect(result[0].accuracy).toBe(1);
  });

  it("drops reviews older than the window", () => {
    const rows = [row(now, 3), row(now - 20 * DAY, 1)];

    const result = computeDailyAccuracy(rows, 14, now);

    expect(result).toHaveLength(1);
    expect(result[0].dayMs).toBe(new Date(2026, 5, 15).getTime());
  });
});

describe("fetchDeckAccuracyHistory", () => {
  // mockClear, NOT mockReset: under vitest 4 a reset mock receives its
  // arguments as nulls, so the per-test mockImplementation never sees the deck.
  beforeEach(() => {
    ankiFetchMock.mockClear();
  });

  it("merges every deck's reviews into one trend", async () => {
    ankiFetchMock.mockImplementation((_action, params) =>
      Promise.resolve(
        (params as { deck: string }).deck === "Spanish"
          ? [row(now, 3)]
          : [row(now - DAY, 1)],
      ),
    );

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
    ankiFetchMock.mockImplementation((_action, params) =>
      (params as { deck: string }).deck === "Spanish"
        ? Promise.resolve([row(now, 3)])
        : Promise.reject(new Error("deck gone")),
    );

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
    ankiFetchMock.mockRejectedValue(new Error("Anki is not running"));

    await expect(
      fetchDeckAccuracyHistory(["Spanish", "Spanish::Verbs"], 14, now),
    ).rejects.toThrow(/could not read review history/i);
  });

  it("resolves empty for an empty deck list rather than throwing", async () => {
    await expect(fetchDeckAccuracyHistory([], 14, now)).resolves.toEqual([]);
    expect(ankiFetchMock).not.toHaveBeenCalled();
  });
});
