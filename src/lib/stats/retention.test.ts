import { describe, it, expect } from "vitest";
import {
  computeRetention,
  computeRetentionTrend,
  MATURE_THRESHOLD_DAYS,
  startOfLocalMonth,
  startOfLocalWeek,
} from "./retention";
import { REVLOG_TYPE, type RevlogEntry } from "./revlog";

const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

const entry = (over: Partial<RevlogEntry> & { id: number }): RevlogEntry => ({
  cardId: 1,
  ease: 3,
  ivl: 30,
  lastIvl: 10, // young by default
  factor: 2500,
  timeMs: 1000,
  type: REVLOG_TYPE.review,
  deck: "Spanish",
  ...over,
});

describe("computeRetention", () => {
  it("splits young from mature and keeps overall as their sum", () => {
    const entries = [
      entry({ id: now, lastIvl: 5, ease: 3 }), // young pass
      entry({ id: now - 1, lastIvl: 5, ease: 1 }), // young fail
      entry({ id: now - 2, lastIvl: 90, ease: 3 }), // mature pass
      entry({ id: now - 3, lastIvl: 90, ease: 4 }), // mature pass
    ];

    const result = computeRetention(entries);

    expect(result.young).toEqual({ reviews: 2, passes: 1, rate: 0.5 });
    expect(result.mature).toEqual({ reviews: 2, passes: 2, rate: 1 });
    expect(result.overall).toEqual({ reviews: 4, passes: 3, rate: 0.75 });
  });

  it("treats exactly the threshold as mature", () => {
    const entries = [
      entry({ id: now, lastIvl: MATURE_THRESHOLD_DAYS }),
      entry({ id: now - 1, lastIvl: MATURE_THRESHOLD_DAYS - 1 }),
    ];

    const result = computeRetention(entries);

    expect(result.mature.reviews).toBe(1);
    expect(result.young.reviews).toBe(1);
  });

  // The whole point of the strict definition: new-card practice and post-lapse
  // drilling are not memory tests.
  it("counts only scheduled reviews", () => {
    const entries = [
      entry({ id: now, type: REVLOG_TYPE.review }),
      entry({ id: now - 1, type: REVLOG_TYPE.learning }),
      entry({ id: now - 2, type: REVLOG_TYPE.relearning }),
      entry({ id: now - 3, type: REVLOG_TYPE.cram }),
      entry({ id: now - 4, type: REVLOG_TYPE.manual, ease: 0 }),
    ];

    expect(computeRetention(entries).overall.reviews).toBe(1);
  });

  // A seconds-scale interval would otherwise be silently filed under "young".
  it("drops a review whose prior interval isn't a positive day count", () => {
    const entries = [
      entry({ id: now, lastIvl: -600 }),
      entry({ id: now - 1, lastIvl: 0 }),
    ];

    const result = computeRetention(entries);

    expect(result.overall.reviews).toBe(0);
  });

  // Rendering 0% for "no mature cards yet" would read as a damning verdict.
  it("reports null, not zero, for an empty bucket", () => {
    const result = computeRetention([entry({ id: now, lastIvl: 5 })]);

    expect(result.mature).toEqual({ reviews: 0, passes: 0, rate: null });
    expect(computeRetention([]).overall.rate).toBeNull();
  });

  it("honours the since bound", () => {
    const entries = [
      entry({ id: now }),
      entry({ id: now - 100 * 86_400_000 }),
    ];

    expect(computeRetention(entries, now - 86_400_000).overall.reviews).toBe(1);
  });
});

describe("calendar helpers", () => {
  it("starts a week on Monday", () => {
    // 2026-06-15 is a Monday; 2026-06-21 the Sunday that closes that week.
    const monday = new Date(2026, 5, 15).getTime();

    expect(startOfLocalWeek(new Date(2026, 5, 15, 9).getTime())).toBe(monday);
    expect(startOfLocalWeek(new Date(2026, 5, 21, 23).getTime())).toBe(monday);
    expect(startOfLocalWeek(new Date(2026, 5, 22, 1).getTime())).toBe(
      new Date(2026, 5, 22).getTime(),
    );
  });

  it("starts a month on the first", () => {
    expect(startOfLocalMonth(now)).toBe(new Date(2026, 5, 1).getTime());
  });
});

describe("computeRetentionTrend", () => {
  it("buckets by month, oldest first", () => {
    const entries = [
      entry({ id: new Date(2026, 3, 10).getTime(), ease: 1 }),
      entry({ id: new Date(2026, 4, 10).getTime(), ease: 3 }),
      entry({ id: new Date(2026, 4, 20).getTime(), ease: 3 }),
    ];

    const result = computeRetentionTrend(entries, "month");

    expect(result.map((p) => p.startMs)).toEqual([
      new Date(2026, 3, 1).getTime(),
      new Date(2026, 4, 1).getTime(),
    ]);
    expect(result[0].overall.rate).toBe(0);
    expect(result[1].overall).toEqual({ reviews: 2, passes: 2, rate: 1 });
  });

  // Sparse on purpose: an empty month has unknown retention, not 0%.
  it("omits periods with no scheduled reviews", () => {
    const entries = [
      entry({ id: new Date(2026, 3, 10).getTime() }),
      entry({ id: new Date(2026, 5, 10).getTime() }),
    ];

    expect(computeRetentionTrend(entries, "month")).toHaveLength(2);
  });

  it("buckets by week when asked", () => {
    const entries = [
      entry({ id: new Date(2026, 5, 15).getTime() }),
      entry({ id: new Date(2026, 5, 21).getTime() }), // same Mon–Sun week
      entry({ id: new Date(2026, 5, 22).getTime() }), // next week
    ];

    const result = computeRetentionTrend(entries, "week");

    expect(result).toHaveLength(2);
    expect(result[0].overall.reviews).toBe(2);
  });
});
