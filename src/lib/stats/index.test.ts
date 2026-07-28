import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearStatsCache, fetchCollectionStats } from "./index";

const { ankiFetchMock, ankiMultiMock } = vi.hoisted(() => ({
  ankiFetchMock: vi.fn(),
  ankiMultiMock: vi.fn(),
}));
vi.mock("../anki-fetch", () => ({
  ankiFetch: ankiFetchMock,
  ankiMulti: ankiMultiMock,
}));

const DAY = 86_400_000;
const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
const day = (offset: number) => new Date(2026, 5, 15 + offset).getTime();

// [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type]
const row = (id: number, cardId: number, ease = 3, lastIvl = 30): number[] => [
  id,
  cardId,
  0,
  ease,
  60,
  lastIvl,
  2500,
  2000,
  1,
];

/** Reviews on consecutive days ending today, one per day. */
const streakRows = (days: number, cardId: number): number[][] =>
  Array.from({ length: days }, (_, i) => row(day(-i) + 3_600_000, cardId));

function mockAnki(
  overrides: {
    decks?: string[];
    reviews?: Record<string, number[][]>;
    findCards?: () => Promise<number[]>;
  } = {},
) {
  const decks = overrides.decks ?? ["Spanish", "French"];
  ankiFetchMock.mockImplementation((action: string) => {
    if (action === "deckNames") return Promise.resolve(decks);
    if (action === "cardsInfo") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected action ${action}`));
  });
  // Both the revlog fan-out and the forecast are batched, so everything else
  // arrives here as one ankiMulti call.
  ankiMultiMock.mockImplementation(
    async (actions: { action: string; params?: Record<string, unknown> }[]) =>
      Promise.all(
        actions.map(async (a) => {
          try {
            if (a.action === "cardReviews") {
              const { deck } = a.params as { deck: string };
              return { ok: true, value: overrides.reviews?.[deck] ?? [] };
            }
            if (a.action === "findCards") {
              return {
                ok: true,
                value: overrides.findCards ? await overrides.findCards() : [],
              };
            }
            throw new Error(`unexpected action ${a.action}`);
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }),
      ),
  );
}

/** Every deck read across all batched calls, for the caching assertions. */
const deckReadCount = () =>
  ankiMultiMock.mock.calls
    .flatMap((c) => c[0] as { action: string }[])
    .filter((a) => a.action === "cardReviews").length;

describe("fetchCollectionStats", () => {
  beforeEach(() => {
    ankiFetchMock.mockClear();
    ankiMultiMock.mockClear();
    // The revlog and forecast are cached across calls, so each test starts from
    // a cold cache or it would assert against the previous test's reads.
    clearStatsCache();
  });

  it("folds one revlog read into every figure on the page", async () => {
    mockAnki({
      reviews: {
        Spanish: streakRows(3, 1),
        French: [row(day(-1) + 7_200_000, 2, 1)],
      },
      findCards: () => Promise.resolve([10, 20]),
    });

    const stats = await fetchCollectionStats({ now });

    expect(stats.totals.reviews).toBe(4);
    expect(stats.totals.cardsSeen).toBe(2);
    expect(stats.streak.current).toBe(3);
    expect(stats.partial).toBe(false);
    // 3 passes out of 4, all mature (lastIvl 30).
    expect(stats.retention.mature).toEqual({
      reviews: 4,
      passes: 3,
      rate: 0.75,
    });
    expect(stats.retention.young.rate).toBeNull();
    // Two rolling windows over the same days, both dense.
    expect(stats.heatmapDays).toHaveLength(365);
    expect(stats.recentDays).toHaveLength(30);
    expect(stats.heatmapDays[364].dayMs).toBe(day(0));
    expect(stats.recentDays[29].dayMs).toBe(day(0));
    expect(stats.forecast).toHaveLength(30);
    expect(stats.forecast?.[0].due).toBe(2);
  });

  it("scopes to a deck without a second revlog read", async () => {
    mockAnki({
      reviews: {
        Spanish: streakRows(3, 1),
        French: [row(day(-1) + 7_200_000, 2)],
      },
    });

    const stats = await fetchCollectionStats({ deckName: "Spanish", now });

    expect(stats.totals.reviews).toBe(3);
    // Still one read per deck — the filter is client-side.
    expect(deckReadCount()).toBe(2);
  });

  it("passes the deck scope into the forecast queries", async () => {
    mockAnki({ reviews: { Spanish: [] } });

    await fetchCollectionStats({ deckName: "Spanish", forecastDays: 1, now });

    const batch = ankiMultiMock.mock.calls
      .flatMap((c) => c[0] as { action: string; params: { query: string } }[])
      .filter((a) => a.action === "findCards");
    expect(batch).toEqual([
      {
        action: "findCards",
        params: { query: 'deck:"Spanish" prop:due<=0 -is:suspended' },
      },
    ]);
  });

  // The deck-tagging design exists so a deck switch is a client-side filter.
  // If this regresses, every switch refetches the whole collection's history.
  it("reuses the cached revlog when the deck filter changes", async () => {
    mockAnki({
      reviews: { Spanish: streakRows(3, 1), French: [row(day(-1), 2)] },
    });

    await fetchCollectionStats({ now });
    const afterFirst = deckReadCount();
    const scoped = await fetchCollectionStats({ deckName: "Spanish", now });

    expect(scoped.totals.reviews).toBe(3);
    expect(deckReadCount()).toBe(afterFirst);
  });

  it("refetches once the cache key changes, so a sync is picked up", async () => {
    mockAnki({ reviews: { Spanish: streakRows(1, 1) } });

    await fetchCollectionStats({ now, cacheKey: 1 });
    await fetchCollectionStats({ now, cacheKey: 2 });

    expect(deckReadCount()).toBe(4); // two decks, twice
  });

  // A dead forecast shouldn't cost the user their history.
  it("degrades the forecast to null instead of failing the page", async () => {
    mockAnki({
      reviews: { Spanish: streakRows(2, 1) },
      findCards: () => Promise.reject(new Error("search failed")),
    });

    const stats = await fetchCollectionStats({ now });

    expect(stats.forecast).toBeNull();
    expect(stats.totals.reviews).toBe(2);
  });

  it("flags a partial revlog read", async () => {
    mockAnki({ reviews: { Spanish: streakRows(2, 1) } });
    ankiMultiMock.mockImplementation(
      async (actions: { action: string; params?: Record<string, unknown> }[]) =>
        actions.map((a) => {
          if (a.action !== "cardReviews") return { ok: true, value: [] };
          const { deck } = a.params as { deck: string };
          return deck === "Spanish"
            ? { ok: true, value: streakRows(2, 1) }
            : { ok: false, error: "deck gone" };
        }),
    );

    const stats = await fetchCollectionStats({ now });

    expect(stats.partial).toBe(true);
    expect(stats.totals.reviews).toBe(2);
  });

  it("throws when the whole revlog is unreadable", async () => {
    mockAnki({ decks: ["Spanish"] });
    ankiMultiMock.mockImplementation(
      async (actions: { action: string }[]) =>
        actions.map((a) =>
          a.action === "cardReviews"
            ? { ok: false, error: "Anki is not running" }
            : { ok: true, value: [] },
        ),
    );

    await expect(fetchCollectionStats({ now })).rejects.toThrow(
      /could not read review history/i,
    );
  });

  it("reports an empty collection without inventing a streak", async () => {
    mockAnki({ reviews: {} });

    const stats = await fetchCollectionStats({ now });

    expect(stats.totals).toEqual({
      reviews: 0,
      seconds: 0,
      firstReviewAt: null,
      cardsSeen: 0,
    });
    expect(stats.streak.current).toBe(0);
    expect(stats.retention.overall.rate).toBeNull();
    expect(stats.medianAnswerSeconds).toBeNull();
    // The heatmap is still a full year of zero-days, so it renders as a grid
    // rather than collapsing.
    expect(stats.heatmapDays).toHaveLength(365);
    expect(stats.heatmapDays.every((d) => d.reviews === 0)).toBe(true);
  });

  it("skips the revlog fan-out entirely when there are no decks", async () => {
    mockAnki({ decks: [] });

    const stats = await fetchCollectionStats({ now });

    expect(stats.totals.reviews).toBe(0);
    expect(deckReadCount()).toBe(0);
  });
});

// Guards the DAY constant staying in sync with the fixtures above.
it("uses whole-day offsets in its fixtures", () => {
  expect(day(-1)).toBe(new Date(2026, 5, 14).getTime());
  expect(day(0) - day(-1)).toBe(DAY);
});
