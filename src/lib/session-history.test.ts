import { describe, it, expect } from "vitest";
import { computeDailyAccuracy } from "./session-history";

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
