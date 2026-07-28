// Recent per-day accuracy for a deck, powering the end-of-session sparkline.
//
// Anki's revlog is a flat stream, so there's no notion of a "session" to compare
// against. Instead we bucket a deck's recent reviews by calendar day and take
// each day's pass rate — a trend the user can read context into (a dip might be
// a new-card day, an off day, or distraction) rather than a single opinionated
// "up/down vs average" verdict.
//
// This deliberately counts EVERY graded press, learning steps included, unlike
// the Stats page's retention (scheduled reviews only). A heavy new-card day is
// almost entirely learning steps; excluding them would blank the sparkline on
// exactly the days the user worked hardest. The two surfaces are labelled
// differently — "Accuracy" here, "Retention" there — because they answer
// different questions.
//
// Built on the shared revlog layer (stats/revlog), which owns the positional
// row format and batches the per-deck fan-out into one request.

import { addDays, startOfLocalDay } from "./stats/activity";
import {
  fetchCollectionRevlog,
  isGraded,
  type RevlogEntry,
} from "./stats/revlog";

/** One day's worth of graded answers in a deck. */
export interface DailyAccuracy {
  /** Local midnight (epoch-ms) for the day. */
  dayMs: number;
  /** Graded answers that day (answer buttons 1–4 only). */
  total: number;
  /** Share graded better than Again (0–1). */
  accuracy: number;
}

/**
 * Fold revlog entries into per-day accuracy over the last `days` days.
 * Pure — no I/O. Skips manual-reschedule rows (ease 0, from Forget / Set Due
 * Date) so only real answer presses count, and dedupes by review id so a
 * review that somehow appears twice is counted once.
 */
export function computeDailyAccuracy(
  entries: RevlogEntry[],
  days: number,
  nowMs: number,
): DailyAccuracy[] {
  const earliest = addDays(nowMs, -(days - 1));
  const byDay = new Map<number, { total: number; passes: number }>();
  const seen = new Set<number>();

  for (const e of entries) {
    if (seen.has(e.id)) continue;
    if (!isGraded(e)) continue;
    const day = startOfLocalDay(e.id);
    if (day < earliest) continue;
    seen.add(e.id);
    const bucket = byDay.get(day) ?? { total: 0, passes: 0 };
    bucket.total++;
    if (e.ease > 1) bucket.passes++;
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .map(([dayMs, b]) => ({ dayMs, total: b.total, accuracy: b.passes / b.total }))
    .sort((a, b) => a.dayMs - b.dayMs);
}

/**
 * Fetch a deck subtree's recent daily accuracy. `deckNames` should be the
 * session's covering decks *and* their subdecks — `cardReviews` reports only a
 * deck's own cards, so fetchCollectionRevlog reads them individually (in one
 * batched request) and merges.
 *
 * Throws when EVERY deck's read failed (fetchCollectionRevlog's contract). An
 * all-failed read is "we don't know your history", which is not the same as
 * "you have no history" — collapsing both to an empty array would let the UI
 * tell a user with months of reviews that they've never studied. Partial
 * failure still resolves; the trend is merely incomplete.
 */
export async function fetchDeckAccuracyHistory(
  deckNames: string[],
  days = 14,
  now = Date.now(),
): Promise<DailyAccuracy[]> {
  const { entries } = await fetchCollectionRevlog(
    deckNames,
    addDays(now, -(days - 1)),
  );
  return computeDailyAccuracy(entries, days, now);
}
