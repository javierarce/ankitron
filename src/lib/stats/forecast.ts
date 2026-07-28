// The coming workload: how many reviews fall due each day, and roughly how
// long they'll take.
//
// Unlike everything else in this directory, the counts can't come from the
// revlog — they're about the future, so they're Anki searches. `prop:due=N`
// matches cards scheduled N days from now; there's no bulk "due per day"
// action, so it's one findCards per day. Ids only, so the payloads stay small.
//
// New cards are deliberately absent: prop:due doesn't match them, and their
// arrival is governed by the deck's daily new limit rather than a due date.
// Label the chart "reviews due" so this doesn't read as a bug.

import { ankiMulti } from "../anki-fetch";
import { isGraded, REVLOG_TYPE, type RevlogEntry } from "./revlog";

/**
 * Below this many samples a median is noise, and a fabricated time estimate is
 * worse than none — the UI shows the due count alone.
 */
const MIN_TIMING_SAMPLES = 20;

/** One day of upcoming work. */
export interface ForecastDay {
  /** 0 = today (including everything overdue), 1 = tomorrow, … */
  dayOffset: number;
  /** Cards due that day, excluding suspended. */
  due: number;
  /** due × median answer time, or null when there's no timing history. */
  minutes: number | null;
}

/**
 * Typical seconds per answer, from scheduled reviews since `sinceMs`.
 *
 * Median, not mean: Anki caps a single answer's recorded time (60s by default),
 * and every walk-away-mid-review lands on that cap. A handful of those drags a
 * mean far above what studying actually feels like, while the median ignores
 * them. Null when there aren't enough samples to be meaningful.
 */
export function computeMedianAnswerSeconds(
  entries: RevlogEntry[],
  sinceMs: number,
): number | null {
  const times: number[] = [];
  for (const e of entries) {
    if (e.id < sinceMs) continue;
    if (!isGraded(e)) continue;
    if (e.type !== REVLOG_TYPE.review) continue;
    times.push(e.timeMs);
  }

  if (times.length < MIN_TIMING_SAMPLES) return null;

  times.sort((a, b) => a - b);
  const mid = times.length >> 1;
  const ms =
    times.length % 2 === 1 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
  return ms / 1000;
}

/** The Anki search for the cards due on a given day offset. */
export function forecastQuery(dayOffset: number, deckName?: string): string {
  // Day 0 uses <= so the overdue backlog folds into today, which is what the
  // user actually faces when they open the app — not a separate number they
  // have to add on themselves.
  const due = dayOffset === 0 ? "prop:due<=0" : `prop:due=${dayOffset}`;
  const scope = deckName ? `deck:"${deckName}" ` : "";
  return `${scope}${due} -is:suspended`;
}

/**
 * Due counts for the next `days` days, starting today.
 *
 * Rejects if any day's query fails: a forecast with one silently-zero day is a
 * chart that lies, so the caller shows the block as unavailable instead. This
 * is the only part of the Stats page that refetches when the deck filter
 * changes — everything else filters the already-fetched revlog client-side.
 */
export async function fetchForecastCounts(
  days: number,
  deckName?: string,
): Promise<Array<{ dayOffset: number; due: number }>> {
  const offsets = Array.from({ length: days }, (_, i) => i);

  // One request, not thirty — see ankiMulti for why that matters so much here.
  const outcomes = await ankiMulti<number[]>(
    offsets.map((dayOffset) => ({
      action: "findCards",
      params: { query: forecastQuery(dayOffset, deckName) },
    })),
  );

  return offsets.map((dayOffset) => {
    // A day that failed must not become a zero: a forecast with one silently
    // empty day is a chart that lies, so the whole block is reported as
    // unavailable instead.
    const outcome = outcomes[dayOffset];
    if (!outcome?.ok || !Array.isArray(outcome.value)) {
      throw new Error("Could not read the upcoming schedule from Anki.");
    }
    return { dayOffset, due: outcome.value.length };
  });
}

/**
 * Pure: turn due counts into a forecast with time estimates. Split from the
 * fetch so the counts can be requested in parallel with the revlog read that
 * produces `medianAnswerSeconds`, rather than waiting on it.
 */
export function attachEstimatedMinutes(
  counts: Array<{ dayOffset: number; due: number }>,
  medianAnswerSeconds: number | null,
): ForecastDay[] {
  return counts.map(({ dayOffset, due }) => ({
    dayOffset,
    due,
    minutes:
      medianAnswerSeconds === null ? null : (due * medianAnswerSeconds) / 60,
  }));
}
