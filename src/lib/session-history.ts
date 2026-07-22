// Recent per-day accuracy for a deck, powering the end-of-session sparkline.
//
// Anki's revlog is a flat stream, so there's no notion of a "session" to compare
// against. Instead we bucket a deck's recent reviews by calendar day and take
// each day's pass rate — a trend the user can read context into (a dip might be
// a new-card day, an off day, or distraction) rather than a single opinionated
// "up/down vs average" verdict. The bucketing is a pure function so it's
// testable without a live Anki; fetchDeckAccuracyHistory is the transport wrapper.

import { ankiFetch } from "./anki-fetch";

const DAY_MS = 86_400_000;

// `cardReviews` rows are [id(ms), cardId, usn, ease, ivl, lastIvl, factor,
// durationMs, type]. We need the review id (for its day + dedupe) and the ease
// (to tell a pass from an Again).
const R_ID = 0;
const R_EASE = 3;

/** One day's worth of graded answers in a deck. */
export interface DailyAccuracy {
  /** Local midnight (epoch-ms) for the day. */
  dayMs: number;
  /** Graded answers that day (answer buttons 1–4 only). */
  total: number;
  /** Share graded better than Again (0–1). */
  accuracy: number;
}

/** Local midnight for a timestamp — the day-bucket key. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Fold raw `cardReviews` rows into per-day accuracy over the last `days` days.
 * Pure — no I/O. Skips manual-reschedule rows (ease 0, from Forget / Set Due
 * Date) so only real answer presses count, and dedupes by review id so a review
 * that somehow appears twice (or under a parent *and* a subdeck) is counted once.
 */
export function computeDailyAccuracy(
  rows: number[][],
  days: number,
  nowMs: number,
): DailyAccuracy[] {
  const earliest = startOfLocalDay(nowMs) - (days - 1) * DAY_MS;
  const byDay = new Map<number, { total: number; passes: number }>();
  const seen = new Set<number>();

  for (const r of rows) {
    const id = r[R_ID];
    if (seen.has(id)) continue;
    const ease = r[R_EASE];
    if (ease < 1 || ease > 4) continue;
    const day = startOfLocalDay(id);
    if (day < earliest) continue;
    seen.add(id);
    const bucket = byDay.get(day) ?? { total: 0, passes: 0 };
    bucket.total++;
    if (ease > 1) bucket.passes++;
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .map(([dayMs, b]) => ({ dayMs, total: b.total, accuracy: b.passes / b.total }))
    .sort((a, b) => a.dayMs - b.dayMs);
}

/**
 * Fetch a deck subtree's recent daily accuracy. `deckNames` should be the
 * session's covering decks *and* their subdecks — `cardReviews` reports only a
 * deck's own cards, so subdecks are fetched individually and merged (dedupe in
 * computeDailyAccuracy guards against any overlap). Each deck's failure resolves
 * to no rows so one bad deck never sinks the whole trend.
 */
export async function fetchDeckAccuracyHistory(
  deckNames: string[],
  days = 14,
  now = Date.now(),
): Promise<DailyAccuracy[]> {
  const startID = startOfLocalDay(now) - (days - 1) * DAY_MS;
  const perDeck = await Promise.all(
    deckNames.map((deck) =>
      ankiFetch<number[][]>("cardReviews", { deck, startID }).catch(() => []),
    ),
  );
  return computeDailyAccuracy(perDeck.flat(), days, now);
}
