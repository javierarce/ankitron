// True retention — the share of *scheduled* reviews the user got right.
//
// This is deliberately stricter than the accuracy figure on the end-of-session
// summary, and the two are not meant to agree:
//
//   - Only type-1 (review) rows count. A learning step isn't a memory test —
//     the card is being seen for the first time — and a relearning step
//     re-tests a card that already counted as a lapse, so including it would
//     penalise the same failure twice. Filtered/cram rows are out because they
//     don't reflect the schedule.
//   - Young and mature are reported separately, because a 95% pass rate made
//     up entirely of 2-day intervals means something very different from the
//     same rate at 6 months.
//
// Session accuracy answers "how did that go?", counting every button press.
// Retention answers "did it stick?". Expect this number to read lower.

import { isGraded, REVLOG_TYPE, type RevlogEntry } from "./revlog";
import { startOfLocalDay } from "./activity";

/** Anki's own young/mature boundary: an interval of three weeks or more. */
export const MATURE_THRESHOLD_DAYS = 21;

export interface RetentionBucket {
  reviews: number;
  passes: number;
  /**
   * passes / reviews, or null when there were none. Never coerced to 0 — a
   * user with no mature cards has *unknown* mature retention, not 0%, and the
   * UI has to say "not enough reviews yet" rather than render a damning zero.
   */
  rate: number | null;
}

export interface Retention {
  young: RetentionBucket;
  mature: RetentionBucket;
  /** Always exactly young + mature, so the split never fails to add up. */
  overall: RetentionBucket;
}

export interface RetentionPoint extends Retention {
  /** Local midnight of the bucket's first day. */
  startMs: number;
}

function bucket(reviews: number, passes: number): RetentionBucket {
  return { reviews, passes, rate: reviews > 0 ? passes / reviews : null };
}

/**
 * Whether a row is a scheduled review worth scoring, and how mature the card
 * was going into it. Returns null for rows that don't count.
 *
 * `lastIvl` is in days when positive and seconds when negative. A negative
 * value can't legitimately occur on a type-1 row, but if one appears we drop it
 * rather than silently bucketing a seconds-scale interval as "young".
 */
function maturityOf(entry: RevlogEntry): "young" | "mature" | null {
  if (!isGraded(entry)) return null;
  if (entry.type !== REVLOG_TYPE.review) return null;
  if (entry.lastIvl >= MATURE_THRESHOLD_DAYS) return "mature";
  if (entry.lastIvl > 0) return "young";
  return null;
}

/** Retention over the given entries, optionally limited to reviews since `sinceMs`. */
export function computeRetention(
  entries: RevlogEntry[],
  sinceMs?: number,
): Retention {
  let youngReviews = 0;
  let youngPasses = 0;
  let matureReviews = 0;
  let maturePasses = 0;

  for (const e of entries) {
    if (sinceMs !== undefined && e.id < sinceMs) continue;
    const maturity = maturityOf(e);
    if (maturity === null) continue;
    const passed = e.ease > 1;
    if (maturity === "mature") {
      matureReviews++;
      if (passed) maturePasses++;
    } else {
      youngReviews++;
      if (passed) youngPasses++;
    }
  }

  return {
    young: bucket(youngReviews, youngPasses),
    mature: bucket(matureReviews, maturePasses),
    overall: bucket(youngReviews + matureReviews, youngPasses + maturePasses),
  };
}

/** Local midnight on the Monday of a timestamp's week. */
export function startOfLocalWeek(ms: number): number {
  const d = new Date(startOfLocalDay(ms));
  // getDay() is 0 for Sunday; shift so Monday is the week's first day.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** Local midnight on the first of a timestamp's month. */
export function startOfLocalMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Retention bucketed over time, oldest first. Sparse — periods with no
 * scheduled reviews are omitted rather than reported as 0%, for the same reason
 * RetentionBucket.rate is nullable. Densify at render time if the chart needs
 * an even x-axis.
 *
 * Weekly buckets start on Monday. Anki's week-start is configurable and not
 * exposed by AnkiConnect, so this can disagree with its own graphs by a day.
 */
export function computeRetentionTrend(
  entries: RevlogEntry[],
  granularity: "week" | "month",
  sinceMs?: number,
): RetentionPoint[] {
  const startOf =
    granularity === "week" ? startOfLocalWeek : startOfLocalMonth;
  const byPeriod = new Map<number, RevlogEntry[]>();

  for (const e of entries) {
    if (sinceMs !== undefined && e.id < sinceMs) continue;
    if (maturityOf(e) === null) continue;
    const start = startOf(e.id);
    const period = byPeriod.get(start);
    if (period) period.push(e);
    else byPeriod.set(start, [e]);
  }

  return [...byPeriod.entries()]
    .map(([startMs, rows]) => ({ startMs, ...computeRetention(rows) }))
    .sort((a, b) => a.startMs - b.startMs);
}
