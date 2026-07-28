// The demo build's revlog has to be good enough to drive the Stats page, which
// is a much higher bar than the rest of the mock: a heatmap, a streak, lifetime
// totals and a young/mature retention split all fold out of these rows. A mock
// that merely returns *something* would render an empty year and a zero streak
// on the marketing site while every unit test still passed.
//
// So these assertions run the mock's own output through the real pipeline and
// check the shape of what a visitor would actually see.

import { describe, it, expect } from "vitest";
import { mockAnki } from "./mock-anki";
import { DEMO_STATS } from "./fixtures";
import {
  computeDailyActivity,
  computeLifetimeTotals,
  computeStreaks,
} from "../stats/activity";
import { computeMedianAnswerSeconds } from "../stats/forecast";
import { computeHardestCards } from "../stats/hardest";
import { computeRetention } from "../stats/retention";
import { parseRevlogRow, REVLOG_TYPE, type RevlogEntry } from "../stats/revlog";

const DAY_MS = 86_400_000;

/** The whole collection's revlog, deduped the way fetchCollectionRevlog does. */
async function collectionRevlog(startID = 0): Promise<RevlogEntry[]> {
  const decks = (await mockAnki("deckNames")) as string[];
  const seen = new Set<number>();
  const entries: RevlogEntry[] = [];

  for (const deck of decks) {
    const rows = (await mockAnki("cardReviews", { deck, startID })) as number[][];
    for (const row of rows) {
      if (seen.has(row[0])) continue;
      seen.add(row[0]);
      entries.push(parseRevlogRow(row, deck));
    }
  }

  return entries;
}

describe("demo revlog", () => {
  it("spans a year, so the rolling heatmap has something to draw", async () => {
    const days = computeDailyActivity(await collectionRevlog());

    // A year's heatmap is 365 cells; a mock covering a fortnight would leave it
    // almost entirely blank.
    expect(days.length).toBeGreaterThan(180);

    const spanDays = (days[days.length - 1].dayMs - days[0].dayMs) / DAY_MS;
    expect(spanDays).toBeGreaterThan(300);
  });

  it("includes reviews today, so the streak isn't zero on arrival", async () => {
    const entries = await collectionRevlog();
    const streak = computeStreaks(computeDailyActivity(entries), Date.now());

    expect(streak.current).toBeGreaterThan(0);
    expect(streak.longest).toBeGreaterThan(streak.current);
  });

  it("has gaps, so the streak and heatmap aren't a solid block", async () => {
    const days = computeDailyActivity(await collectionRevlog());
    const span = (days[days.length - 1].dayMs - days[0].dayMs) / DAY_MS + 1;

    // Studied on most days but not all — a perfect record would make the
    // heatmap and the "longest streak" tile meaningless.
    expect(days.length).toBeLessThan(span);
  });

  // The retention block reports young and mature separately; a fixture whose
  // intervals never cross 21 days would leave half of it permanently empty.
  it("crosses the young/mature boundary in both directions", async () => {
    const retention = computeRetention(await collectionRevlog());

    expect(retention.young.reviews).toBeGreaterThan(0);
    expect(retention.mature.reviews).toBeGreaterThan(0);
    // Plausible, not perfect: a 100% rate would look fake.
    expect(retention.overall.rate).toBeGreaterThan(0.6);
    expect(retention.overall.rate).toBeLessThan(1);
  });

  it("carries learning steps as well as scheduled reviews", async () => {
    const entries = await collectionRevlog();
    const types = new Set(entries.map((e) => e.type));

    expect(types.has(REVLOG_TYPE.learning)).toBe(true);
    expect(types.has(REVLOG_TYPE.review)).toBe(true);
  });

  // Durations vary either side of secondsPerCard so the answer-time median has
  // spread to work with, but must still centre on the figure the "N cards in
  // ~M min" footer quotes.
  it("keeps the answer-time median on the demo's advertised pace", async () => {
    const entries = await collectionRevlog();
    const median = computeMedianAnswerSeconds(entries, 0);

    expect(median).not.toBeNull();
    expect(median).toBeCloseTo(DEMO_STATS.secondsPerCard, 0);
  });

  it("reports lifetime totals across many cards", async () => {
    const totals = computeLifetimeTotals(await collectionRevlog());

    expect(totals.cardsSeen).toBeGreaterThan(10);
    expect(totals.reviews).toBeGreaterThan(totals.cardsSeen);
    expect(totals.seconds).toBeGreaterThan(0);
  });

  // cardReviews must report a deck's OWN cards, like real AnkiConnect. If it
  // returns the subtree, the parent-first fan-out tags a subdeck's rows with
  // the parent and every narrower deck filter renders the empty state.
  it("reports each deck's own cards, so subdeck filters aren't empty", async () => {
    const decks = (await mockAnki("deckNames")) as string[];
    const subdecks = decks.filter((d) => d.includes("::"));
    expect(subdecks.length).toBeGreaterThan(0);

    const entries = await collectionRevlog();
    for (const deck of subdecks) {
      const scoped = entries.filter(
        (e) => e.deck === deck || e.deck.startsWith(`${deck}::`),
      );
      expect(scoped.length).toBeGreaterThan(0);
    }
  });

  it("never tags a row with an ancestor of the deck that owns it", async () => {
    const decks = (await mockAnki("deckNames")) as string[];
    for (const deck of decks) {
      const rows = (await mockAnki("cardReviews", {
        deck,
        startID: 0,
      })) as number[][];
      const others = decks.filter((d) => d.startsWith(`${deck}::`));
      for (const child of others) {
        const childRows = (await mockAnki("cardReviews", {
          deck: child,
          startID: 0,
        })) as number[][];
        const ids = new Set(rows.map((r) => r[0]));
        // No overlap: a card belongs to exactly one deck.
        expect(childRows.some((r) => ids.has(r[0]))).toBe(false);
      }
    }
  });

  // The Trouble Spots block ranks lapsing cards and resolves them via
  // cardsInfo. Archive cards must resolve to a real fixture note in their own
  // deck, or the demo's fix-list renders empty (or links to the wrong deck).
  it("resolves its top lapsers to real notes in the right decks", async () => {
    const entries = await collectionRevlog();
    const candidates = computeHardestCards(entries);
    expect(candidates.length).toBeGreaterThan(0);

    const infos = (await mockAnki("cardsInfo", {
      cards: candidates.map((c) => c.cardId),
    })) as { cardId: number; noteId: number; deckName: string; question: string }[];

    // Enough resolve to fill the 6-tile grid.
    expect(infos.length).toBeGreaterThanOrEqual(6);
    const byCard = new Map(entries.map((e) => [e.cardId, e.deck]));
    for (const info of infos) {
      expect(info.question.length).toBeGreaterThan(0);
      // The resolved note lives in the deck the card's reviews are tagged
      // with, so the row's deck link holds.
      expect(info.deckName).toBe(byCard.get(info.cardId));
    }
  });

  it("honours startID so a windowed fetch stays cheap", async () => {
    const cutoff = Date.now() - 7 * DAY_MS;
    const [all, recent] = [await collectionRevlog(), await collectionRevlog(cutoff)];

    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length);
    expect(recent.every((e) => e.id >= cutoff)).toBe(true);
  });
});
