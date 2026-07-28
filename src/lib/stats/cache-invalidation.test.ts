// The Stats cache must drop whenever the collection changes in a way the sync
// counter can't see: grading, undo, and — the case a review caught missing —
// deleting notes or moving cards. Invalidation lives in the transport layer
// (anki-fetch clears on any STATS_MUTATING action), so these tests run the
// REAL ankiFetch against a mocked global fetch: mocking ankiFetch itself would
// bypass exactly the mechanism under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ankiFetch, ankiMulti } from "../anki-fetch";
import { clearStatsCache, fetchCollectionStats } from "./index";

const originalFetch = globalThis.fetch;

/** Route requests by action; unlisted actions resolve with a null result. */
function mockAnkiServer(handlers: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string);
    if (body.action === "multi") {
      const results = body.params.actions.map(
        (a: { action: string }) => ({
          result: handlers[a.action] ?? [],
          error: null,
        }),
      );
      return new Response(JSON.stringify({ result: results, error: null }));
    }
    return new Response(
      JSON.stringify({ result: handlers[body.action] ?? null, error: null }),
    );
  }) as typeof fetch;
}

/** How many requests carried a cardReviews read — the expensive fetch. */
const revlogReads = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.filter((c) =>
      String((c[1] as RequestInit).body).includes('"cardReviews"'),
    ).length;

describe("stats cache invalidation (transport level)", () => {
  beforeEach(() => {
    clearStatsCache();
    mockAnkiServer({
      deckNames: ["Spanish"],
      guiAnswerCard: true,
      guiUndo: null,
      deleteNotes: null,
      findCards: [],
      cardReviews: [],
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reuses the cache when only reads have happened", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiFetch("deckNames");
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(1);
  });

  it("refetches after a card is graded", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiFetch("guiAnswerCard", { ease: 3 });
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(2);
  });

  it("refetches after an undo", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiFetch("guiUndo");
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(2);
  });

  // The gap the per-callsite version shipped with: deletion removes revlog
  // rows, and nothing at the call site remembered to clear.
  it("refetches after notes are deleted", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiFetch("deleteNotes", { notes: [1] });
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(2);
  });

  it("refetches after cards move deck, since attribution follows the card", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiFetch("changeDeck", { cards: [1], deck: "French" });
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(2);
  });

  // ankiFetch's check sees only the outer "multi" verb, so mutating
  // sub-actions have to be caught inside ankiMulti itself.
  it("refetches after a batched mutation", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await ankiMulti([{ action: "suspend", params: { cards: [1] } }]);
    await fetchCollectionStats({ cacheKey: 1 });

    expect(revlogReads()).toBe(2);
  });

  it("does not refetch after a failed mutation", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ result: null, error: "collection is not available" }),
      ),
    ) as typeof fetch;
    await expect(ankiFetch("deleteNotes", { notes: [1] })).rejects.toThrow();

    mockAnkiServer({ deckNames: ["Spanish"], cardReviews: [], findCards: [] });
    await fetchCollectionStats({ cacheKey: 1 });

    // Nothing was written, so the cache was still valid — but the counter
    // reset with the second mockAnkiServer, so assert zero new reads instead.
    expect(revlogReads()).toBe(0);
  });

  // The write happens after an await, so a clear landing mid-flight must not
  // be overwritten by the resolving fetch — that would re-cache pre-mutation
  // history under a key the invalidation already spent.
  it("does not repopulate the cache with a fetch that predates a mutation", async () => {
    let releaseRevlog!: () => void;
    const gate = new Promise<void>((r) => (releaseRevlog = r));
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.action === "multi") {
        const isRevlog = body.params.actions.some(
          (a: { action: string }) => a.action === "cardReviews",
        );
        if (isRevlog) await gate; // hold the revlog read in flight
        const results = body.params.actions.map(() => ({
          result: [],
          error: null,
        }));
        return new Response(JSON.stringify({ result: results, error: null }));
      }
      const result = body.action === "deckNames" ? ["Spanish"] : true;
      return new Response(JSON.stringify({ result, error: null }));
    }) as typeof fetch;

    const inFlight = fetchCollectionStats({ cacheKey: 1 });
    // Let the fetch reach the gated revlog read, then grade a card.
    await new Promise((r) => setTimeout(r, 0));
    await ankiFetch("guiAnswerCard", { ease: 3 });
    releaseRevlog();
    await inFlight;

    // The resolved (pre-mutation) data must not have been cached: the next
    // call refetches instead of serving it.
    await fetchCollectionStats({ cacheKey: 1 });
    expect(revlogReads()).toBe(2);
  });

  it("refetches once the cache key changes, so a sync is picked up", async () => {
    await fetchCollectionStats({ cacheKey: 1 });
    await fetchCollectionStats({ cacheKey: 2 });

    expect(revlogReads()).toBe(2);
  });
});
