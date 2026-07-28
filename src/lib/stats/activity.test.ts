import { describe, it, expect } from "vitest";
import {
  computeDailyActivity,
  computeLifetimeTotals,
  computeStreaks,
  densifyDays,
  nextDay,
  previousDay,
  startOfLocalDay,
  type DayActivity,
} from "./activity";
import { REVLOG_TYPE, type RevlogEntry } from "./revlog";

// Midday so ±DAY offsets stay within their own calendar day.
const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
const day = (offset: number) => new Date(2026, 5, 15 + offset).getTime();

const entry = (over: Partial<RevlogEntry> & { id: number }): RevlogEntry => ({
  cardId: 1,
  ease: 3,
  ivl: 10,
  lastIvl: 5,
  factor: 2500,
  timeMs: 1000,
  type: REVLOG_TYPE.review,
  deck: "Spanish",
  ...over,
});

/** A day bucket, for the streak tests that don't care about the fold. */
const studied = (offset: number): DayActivity => ({
  dayMs: day(offset),
  reviews: 1,
  passes: 1,
  seconds: 1,
});

describe("day helpers", () => {
  // Guards the DST reasoning: plain ±86_400_000 drifts across a boundary,
  // going through local midnight does not.
  it("round-trips a day in both directions", () => {
    const today = startOfLocalDay(now);

    expect(nextDay(previousDay(today))).toBe(today);
    expect(previousDay(nextDay(today))).toBe(today);
  });
});

describe("computeDailyActivity", () => {
  it("buckets by local day, counting passes and time", () => {
    const entries = [
      entry({ id: now, ease: 3, timeMs: 2000 }),
      entry({ id: now - 60_000, ease: 1, timeMs: 3000 }),
      entry({ id: day(-1) + 3_600_000, ease: 4, timeMs: 1000 }),
    ];

    const result = computeDailyActivity(entries);

    expect(result.map((d) => d.dayMs)).toEqual([day(-1), day(0)]); // oldest first
    expect(result[1]).toEqual({
      dayMs: day(0),
      reviews: 2,
      passes: 1, // the Again doesn't count
      seconds: 5,
    });
  });

  it("ignores manual reschedules", () => {
    const entries = [
      entry({ id: now, ease: 3 }),
      entry({ id: now - 30_000, ease: 0, type: REVLOG_TYPE.manual }),
    ];

    const result = computeDailyActivity(entries);

    expect(result).toHaveLength(1);
    expect(result[0].reviews).toBe(1);
  });

  it("returns nothing for no entries", () => {
    expect(computeDailyActivity([])).toEqual([]);
  });
});

describe("computeStreaks", () => {
  it("counts consecutive days ending today", () => {
    const days = [studied(-2), studied(-1), studied(0)];

    expect(computeStreaks(days, now).current).toBe(3);
  });

  // The one that matters at 00:01: the user hasn't studied yet today, but
  // yesterday's streak is very much alive.
  it("keeps the streak alive when today is still empty", () => {
    const days = [studied(-2), studied(-1)];

    const result = computeStreaks(days, now);

    expect(result.current).toBe(2);
    expect(result.lastStudiedDay).toBe(day(-1));
  });

  it("breaks the streak once a whole day has passed with nothing", () => {
    const days = [studied(-5), studied(-4), studied(-2)];

    // Yesterday and today are both empty, so nothing is running.
    expect(computeStreaks(days, now).current).toBe(0);
  });

  it("reports the longest run anywhere in history", () => {
    const days = [
      studied(-10),
      studied(-9),
      studied(-8),
      studied(-7), // a run of 4
      studied(-3),
      studied(-2), // a run of 2, nearer the present
    ];

    const result = computeStreaks(days, now);

    expect(result.longest).toBe(4);
    expect(result.current).toBe(0);
    expect(result.activeDays).toBe(6);
  });

  it("handles a single studied day", () => {
    const result = computeStreaks([studied(0)], now);

    expect(result).toEqual({
      current: 1,
      longest: 1,
      lastStudiedDay: day(0),
      activeDays: 1,
    });
  });

  it("reports zeros for an empty history", () => {
    expect(computeStreaks([], now)).toEqual({
      current: 0,
      longest: 0,
      lastStudiedDay: null,
      activeDays: 0,
    });
  });
});

describe("computeLifetimeTotals", () => {
  it("sums graded answers and counts distinct cards", () => {
    const entries = [
      entry({ id: day(-30), cardId: 1, timeMs: 2000 }),
      entry({ id: day(-10), cardId: 1, timeMs: 3000 }),
      entry({ id: now, cardId: 2, timeMs: 1000 }),
    ];

    expect(computeLifetimeTotals(entries)).toEqual({
      reviews: 3,
      seconds: 6,
      firstReviewAt: day(-30),
      cardsSeen: 2,
    });
  });

  it("excludes manual reschedules from every total", () => {
    const entries = [
      entry({ id: now, cardId: 1, timeMs: 1000 }),
      entry({ id: day(-40), cardId: 9, ease: 0, type: REVLOG_TYPE.manual }),
    ];

    const result = computeLifetimeTotals(entries);

    expect(result.reviews).toBe(1);
    expect(result.cardsSeen).toBe(1);
    // The manual row is older, but it must not become "first reviewed".
    expect(result.firstReviewAt).toBe(now);
  });

  it("reports null first review for an empty history", () => {
    expect(computeLifetimeTotals([])).toEqual({
      reviews: 0,
      seconds: 0,
      firstReviewAt: null,
      cardsSeen: 0,
    });
  });
});

describe("densifyDays", () => {
  it("fills gaps with zero-days across an inclusive range", () => {
    const days = [studied(-3), studied(-1)];

    const result = densifyDays(days, day(-3), day(0));

    expect(result.map((d) => d.reviews)).toEqual([1, 0, 1, 0]);
    expect(result.map((d) => d.dayMs)).toEqual([
      day(-3),
      day(-2),
      day(-1),
      day(0),
    ]);
  });

  it("normalises bounds given mid-day", () => {
    const result = densifyDays([], now, now);

    expect(result).toEqual([
      { dayMs: day(0), reviews: 0, passes: 0, seconds: 0 },
    ]);
  });

  it("drops days outside the window", () => {
    const result = densifyDays([studied(-10), studied(0)], day(-1), day(0));

    expect(result).toHaveLength(2);
    expect(result[1].reviews).toBe(1);
  });
});
