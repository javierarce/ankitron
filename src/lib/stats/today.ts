// Today's study totals — the "Studied N cards in M minutes" footer on the
// home page.
//
// Moved here from anki-fetch.ts when the revlog gained a single parsed form:
// this is a revlog consumer, not a transport helper, and keeping it beside
// the parser means one module owns the positional-row layout.

import { ankiFetch } from "../anki-fetch";
import type { StudyStats } from "../types";
import { fetchCollectionRevlog } from "./revlog";

/**
 * Today's study totals, matching Anki's main-screen line. The card count comes
 * straight from `getNumCardsReviewedToday` (which honours Anki's day-rollover
 * hour). For time, we can't ask AnkiConnect for "today's reviews" directly, so
 * we pull recent reviews (one batched request via fetchCollectionRevlog), take
 * the most recent N (N = today's count — reviews are chronological, so the
 * newest N are exactly today's), and sum their durations. The lookback window
 * only needs to exceed one Anki day.
 */
export async function fetchTodayStudyStats(
  deckNames: string[],
): Promise<StudyStats> {
  const cards = await ankiFetch<number>("getNumCardsReviewedToday");
  if (cards <= 0) return { cards: 0, seconds: 0 };

  const lookbackMs = 2 * 24 * 60 * 60 * 1000; // two days, safely past any rollover
  const { entries } = await fetchCollectionRevlog(
    deckNames,
    Date.now() - lookbackMs,
  );

  const totalMs = entries
    .sort((a, b) => b.id - a.id)
    .slice(0, cards)
    .reduce((sum, e) => sum + e.timeMs, 0);

  return { cards, seconds: totalMs / 1000 };
}
