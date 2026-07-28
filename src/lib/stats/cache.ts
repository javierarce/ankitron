// The Stats page's cached reads, in a leaf module.
//
// Two reasons this isn't part of ./index:
//
//   - Invalidation lives in the transport layer (anki-fetch.ts clears on any
//     revlog-affecting action), and the transport must not import the stats
//     aggregation graph — that would be a runtime cycle (index → revlog →
//     anki-fetch → index). This module's only import is a type, which erases
//     at compile time, so it is safe to import from anywhere.
//
//   - review/study code once imported clearStatsCache through the ./stats
//     barrel, dragging the whole aggregation graph into the study bundle's
//     import tree and trusting tree-shaking to drop it. A leaf module makes
//     that a non-issue.

import type { RevlogEntry } from "./revlog";

interface RevlogCacheEntry {
  key: number;
  entries: RevlogEntry[];
  partial: boolean;
}

/**
 * Mutable cache state, owned here, read/written by ./index's cachedRevlog and
 * cachedForecast. `key` is the caller's cache key (the sync counter), so a
 * completed sync naturally invalidates without anyone calling clear.
 */
export const statsCache = {
  revlog: null as RevlogCacheEntry | null,
  forecast: new Map<string, Array<{ dayOffset: number; due: number }>>(),
  /**
   * Bumped by every clear. Writers snapshot it BEFORE their fetch and store
   * only if it hasn't moved: a clear landing while a fetch is in flight
   * would otherwise be overwritten when that fetch resolves, re-caching the
   * pre-mutation history under an unchanged key — stale until the next
   * mutation or sync.
   */
  generation: 0,
};

/**
 * Drop every cached read. Called by the transport layer whenever an action
 * that can change the revlog, deck attribution, or due schedule succeeds —
 * grading, undo, note/deck deletion, deck moves, suspend — so the Stats page
 * can never serve figures that include deleted history or miss new reviews.
 */
export function clearStatsCache(): void {
  statsCache.revlog = null;
  statsCache.forecast.clear();
  statsCache.generation++;
}
