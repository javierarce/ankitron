// The Stats page's one data entry point.
//
// The revlog is the expensive read, so it happens once and every figure below
// is a pure fold over it. Deck scoping is a client-side filter on those same
// entries (rows are tagged with their deck at fetch time), which is what lets
// the deck dropdown switch instantly: the revlog is cached, and only the
// forecast goes back to Anki — as one batched request, cached per deck.
//
// The rolling windows are policy decided here rather than by the page: 12
// months for the heatmap and headline retention, 30 days for the recent bar
// chart and the answer-time median. They roll rather than aligning to a
// calendar month or year, because a calendar window is nearly empty on its
// first day and splits a streak in two at the boundary.

import { fetchDeckNames } from "../decks";
import {
  addDays,
  computeDailyActivity,
  computeLifetimeTotals,
  computeStreaks,
  densifyDays,
  startOfLocalDay,
  type DayActivity,
  type LifetimeTotals,
  type StreakInfo,
} from "./activity";
import {
  attachEstimatedMinutes,
  computeMedianAnswerSeconds,
  fetchForecastCounts,
  type ForecastDay,
} from "./forecast";
import { computeHardestCards, resolveHardestNotes, type HardestNote } from "./hardest";
import {
  computeRetention,
  computeRetentionTrend,
  type Retention,
  type RetentionPoint,
} from "./retention";
import { statsCache, clearStatsCache } from "./cache";
import { fetchCollectionRevlog, filterByDeck, type RevlogEntry } from "./revlog";

const HEATMAP_DAYS = 365;
const RECENT_DAYS = 30;
const TIMING_WINDOW_DAYS = 30;
const FORECAST_DAYS = 30;

// --- Caches -----------------------------------------------------------------
//
// The whole point of tagging rows with their deck (see ./revlog) is that a deck
// filter is a client-side predicate — but that only pays off if the revlog
// isn't refetched to apply it. These reads make switching decks feel instant:
// the revlog is fetched once, and only the forecast (a server-side search)
// goes back to Anki, once per deck per day.
//
// The state lives in ./cache (a leaf module) because invalidation is the
// transport layer's job: anki-fetch clears it whenever a revlog-affecting
// action succeeds. The caller-supplied `cacheKey` — the page passes the sync
// counter — handles the other direction, a sync bringing in remote reviews.

async function cachedRevlog(key: number) {
  if (statsCache.revlog?.key === key) return statsCache.revlog;
  const generation = statsCache.generation;
  const deckNames = await fetchDeckNames();
  const { entries, partial } = await fetchCollectionRevlog(deckNames);
  const result = { key, entries, partial };
  // Store only if no clear landed while the fetch was in flight — this data
  // predates that mutation, so caching it would serve pre-mutation history
  // under a key the invalidation already spent. The caller still gets it:
  // one nearly-current render beats an error, and the next call refetches.
  if (statsCache.generation === generation) statsCache.revlog = result;
  return result;
}

async function cachedForecast(
  key: number,
  days: number,
  anchorDayMs: number,
  deckName?: string,
): Promise<Array<{ dayOffset: number; due: number }> | null> {
  // The anchor day is part of the key: prop:due counts are relative to the
  // day they were asked on, so yesterday evening's forecast must not be
  // served this morning as if its day 0 were still today.
  const cacheKey = `${key}|${days}|${anchorDayMs}|${deckName ?? ""}`;
  const hit = statsCache.forecast.get(cacheKey);
  if (hit) return hit;
  const generation = statsCache.generation;
  try {
    const counts = await fetchForecastCounts(days, deckName);
    // Only a successful read is cached (a transient failure doesn't stick),
    // and only if no clear landed mid-flight — same race as cachedRevlog.
    if (statsCache.generation === generation) {
      statsCache.forecast.set(cacheKey, counts);
    }
    return counts;
  } catch {
    return null;
  }
}

/** Local midnight `n` days before `nowMs`. Calendar arithmetic — see addDays. */
function daysAgo(nowMs: number, n: number): number {
  return addDays(nowMs, -n);
}

export interface CollectionStats {
  totals: LifetimeTotals;
  streak: StreakInfo;
  /** Dense, rolling 12 months — every day present so gaps render as gaps. */
  heatmapDays: DayActivity[];
  /** Dense, rolling 30 days. */
  recentDays: DayActivity[];
  /** Headline retention over the same rolling 12 months as the heatmap. */
  retention: Retention;
  /** Monthly buckets across that year; sparse (see computeRetentionTrend). */
  retentionTrend: RetentionPoint[];
  /** Null when the forecast queries failed — that block degrades on its own. */
  forecast: ForecastDay[] | null;
  /**
   * Local midnight of the day the forecast's dayOffset 0 refers to. Axis
   * labels must derive dates from THIS, never from the clock at render time:
   * a page rendered after midnight with counts fetched before it would
   * otherwise put every bar under the following day's label.
   */
  forecastAnchorMs: number;
  /**
   * The notes failing most often, ready to act on. Null when the resolve
   * failed; empty when nothing lapses repeatedly — a state worth showing.
   */
  hardest: HardestNote[] | null;
  medianAnswerSeconds: number | null;
  /** True when at least one deck's revlog read failed; surface it in the UI. */
  partial: boolean;
}

/**
 * Everything the Stats page renders. `deckName` scopes to a deck and its
 * subdecks; omit it for the whole collection.
 *
 * Throws only when the revlog is entirely unreadable (Anki down, every deck
 * failing) — that's a page-level error. A partial revlog read sets `partial`,
 * and a failed forecast leaves `forecast` null, so both degrade to a block
 * rather than an empty page.
 */
export async function fetchCollectionStats(options?: {
  deckName?: string;
  forecastDays?: number;
  now?: number;
  /** Changes invalidate the caches; the page passes the sync timestamp. */
  cacheKey?: number;
}): Promise<CollectionStats> {
  const now = options?.now ?? Date.now();
  const deckName = options?.deckName;
  const forecastDays = options?.forecastDays ?? FORECAST_DAYS;
  const cacheKey = options?.cacheKey ?? 0;

  const today = startOfLocalDay(now);

  // The forecast is independent of the revlog, so it starts immediately rather
  // than queueing behind the collection's whole history. On a deck switch both
  // are usually cache hits or a single batched request.
  const [revlog, counts] = await Promise.all([
    cachedRevlog(cacheKey),
    cachedForecast(cacheKey, forecastDays, today, deckName),
  ]);

  const { entries, partial } = revlog;
  const scoped = filterByDeck(entries, deckName);

  const days = computeDailyActivity(scoped);
  const yearStart = daysAgo(now, HEATMAP_DAYS - 1);

  // Ranked from the already-fetched revlog over the same rolling year as
  // retention; only the top candidates cost a cardsInfo call, and a failure
  // degrades this block alone.
  const hardest = await resolveHardestNotes(
    computeHardestCards(scoped, yearStart),
  ).catch(() => null);
  const medianAnswerSeconds = computeMedianAnswerSeconds(
    scoped,
    daysAgo(now, TIMING_WINDOW_DAYS - 1),
  );

  return {
    totals: computeLifetimeTotals(scoped),
    streak: computeStreaks(days, now),
    heatmapDays: densifyDays(days, yearStart, today),
    recentDays: densifyDays(days, daysAgo(now, RECENT_DAYS - 1), today),
    retention: computeRetention(scoped, yearStart),
    retentionTrend: computeRetentionTrend(scoped, "month", yearStart),
    forecast:
      counts === null ? null : attachEstimatedMinutes(counts, medianAnswerSeconds),
    forecastAnchorMs: today,
    hardest,
    medianAnswerSeconds,
    partial,
  };
}

export { clearStatsCache };
export type { RevlogEntry };
export type { HardestNote } from "./hardest";
export type {
  DayActivity,
  ForecastDay,
  LifetimeTotals,
  Retention,
  RetentionPoint,
  StreakInfo,
};
