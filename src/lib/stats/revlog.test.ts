import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchCollectionRevlog,
  filterByDeck,
  isGraded,
  parseRevlogRow,
  REVLOG_TYPE,
  type RevlogEntry,
} from "./revlog";

// Hoisted so the vi.mock factory below can close over it without a dynamic
// import (an async vi.mock factory that imports deadlocks vitest here).
const { ankiFetchMock, ankiMultiMock } = vi.hoisted(() => ({
  ankiFetchMock: vi.fn(),
  ankiMultiMock: vi.fn(),
}));
vi.mock("../anki-fetch", () => ({
  ankiFetch: ankiFetchMock,
  ankiMulti: ankiMultiMock,
}));

// ankiMulti is mocked rather than exercised here — its envelope handling has
// its own tests in anki-fetch.test.ts. This drives it from a per-action
// handler, mirroring its outcome contract.
function multiHandler(
  handle: (action: string, params: Record<string, unknown>) => Promise<unknown>,
) {
  ankiMultiMock.mockImplementation(
    async (actions: { action: string; params?: Record<string, unknown> }[]) =>
      Promise.all(
        actions.map(async (a) => {
          try {
            return { ok: true, value: await handle(a.action, a.params ?? {}) };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }),
      ),
  );
}


// [id, cardId, usn, ease, ivl, lastIvl, factor, durationMs, type]
const row = (id: number, over: Partial<Record<string, number>> = {}): number[] => [
  id,
  over.cardId ?? 1,
  0,
  over.ease ?? 3,
  over.ivl ?? 10,
  over.lastIvl ?? 5,
  2500,
  over.timeMs ?? 1000,
  over.type ?? REVLOG_TYPE.review,
];

const entry = (over: Partial<RevlogEntry> = {}): RevlogEntry => ({
  id: 1,
  cardId: 1,
  ease: 3,
  ivl: 10,
  lastIvl: 5,
  factor: 2500,
  timeMs: 1000,
  type: REVLOG_TYPE.review,
  deck: "Spanish",
  ...over,
});

describe("parseRevlogRow", () => {
  it("maps every positional column onto its name", () => {
    const parsed = parseRevlogRow([111, 222, 0, 2, 30, 12, 2350, 4500, 1], "French");

    expect(parsed).toEqual({
      id: 111,
      cardId: 222,
      ease: 2,
      ivl: 30,
      lastIvl: 12,
      factor: 2350,
      timeMs: 4500,
      type: 1,
      deck: "French",
    });
  });

  it("defaults a missing duration to zero rather than NaN", () => {
    // A short row would otherwise poison every time total on the page.
    expect(parseRevlogRow([111, 222, 0, 3, 30, 12, 2500], "French").timeMs).toBe(0);
  });
});

describe("isGraded", () => {
  it("accepts the four answer buttons", () => {
    for (const ease of [1, 2, 3, 4]) {
      expect(isGraded(entry({ ease }))).toBe(true);
    }
  });

  // Forget / Set Due Date write ease-0 rows that aren't answer presses.
  it("rejects manual reschedule rows", () => {
    expect(isGraded(entry({ ease: 0, type: REVLOG_TYPE.manual }))).toBe(false);
  });
});

describe("filterByDeck", () => {
  const entries = [
    entry({ id: 1, deck: "Spanish" }),
    entry({ id: 2, deck: "Spanish::Verbs" }),
    entry({ id: 3, deck: "Spanish 2" }),
    entry({ id: 4, deck: "French" }),
  ];

  it("returns everything when no deck is selected", () => {
    expect(filterByDeck(entries)).toHaveLength(4);
  });

  it("includes subdecks but not similarly-named decks", () => {
    const scoped = filterByDeck(entries, "Spanish");

    expect(scoped.map((e) => e.id)).toEqual([1, 2]);
  });

  it("scopes to a subdeck without pulling in its parent", () => {
    expect(filterByDeck(entries, "Spanish::Verbs").map((e) => e.id)).toEqual([2]);
  });
});

describe("fetchCollectionRevlog", () => {
  // mockClear, NOT mockReset: under vitest 4 a reset mock receives its
  // arguments as nulls, so the per-test mockImplementation never sees the deck.
  beforeEach(() => {
    ankiFetchMock.mockClear();
    ankiMultiMock.mockClear();
  });

  it("tags each row with the deck it was fetched under", async () => {
    multiHandler(async (_action, params) =>
      (params as { deck: string }).deck === "Spanish" ? [row(1)] : [row(2)],
    );

    const { entries, partial } = await fetchCollectionRevlog([
      "Spanish",
      "French",
    ]);

    expect(entries.map((e) => [e.id, e.deck])).toEqual([
      [1, "Spanish"],
      [2, "French"],
    ]);
    expect(partial).toBe(false);
  });

  it("requests all history in one batch by default", async () => {
    multiHandler(async () => []);

    await fetchCollectionRevlog(["Spanish"]);

    // One request for the whole collection, not one per deck.
    expect(ankiMultiMock).toHaveBeenCalledTimes(1);
    expect(ankiMultiMock.mock.calls[0][0]).toEqual([
      { action: "cardReviews", params: { deck: "Spanish", startID: 0 } },
    ]);
  });

  it("dedupes a review id seen under two decks", async () => {
    multiHandler(async () => [row(7)]);

    const { entries } = await fetchCollectionRevlog(["Spanish", "French"]);

    expect(entries).toHaveLength(1);
    expect(entries[0].deck).toBe("Spanish"); // first occurrence wins
  });

  // One unreadable subdeck shouldn't cost the user the whole page.
  it("tolerates a partial failure and flags it", async () => {
    multiHandler(async (_action, params) => {
      if ((params as { deck: string }).deck !== "Spanish") {
        throw new Error("deck gone");
      }
      return [row(1)];
    });

    const { entries, partial } = await fetchCollectionRevlog([
      "Spanish",
      "French",
    ]);

    expect(entries).toHaveLength(1);
    expect(partial).toBe(true);
  });

  // The important one: an all-failed read must not look like "no history", or
  // the page tells a user with years of reviews that they've never studied.
  it("throws when every deck's read fails", async () => {
    multiHandler(async () => {
      throw new Error("Anki is not running");
    });

    await expect(
      fetchCollectionRevlog(["Spanish", "French"]),
    ).rejects.toThrow(/could not read review history/i);
  });

  it("resolves empty for an empty deck list rather than throwing", async () => {
    await expect(fetchCollectionRevlog([])).resolves.toEqual({
      entries: [],
      partial: false,
    });
    expect(ankiMultiMock).not.toHaveBeenCalled();
  });
});
