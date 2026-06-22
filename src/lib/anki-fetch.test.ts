import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ankiFetch,
  fetchDueCount,
  fetchAllDueCounts,
  fetchAllNoteCounts,
} from "./anki-fetch";

describe("ankiFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a POST to /api/anki", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: ["Default"], error: null })),
    );

    const result = await ankiFetch<string[]>("deckNames");

    expect(result).toEqual(["Default"]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/anki");
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body as string)).toEqual({
      action: "deckNames",
      version: 6,
    });
  });

  it("passes params in the request body", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 42, error: null })),
    );

    await ankiFetch("createDeck", { deck: "Test" });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body).toEqual({
      action: "createDeck",
      version: 6,
      params: { deck: "Test" },
    });
  });

  it("throws when AnkiConnect returns an error", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: null, error: "deck not found" })),
    );

    await expect(ankiFetch("deckNames")).rejects.toThrow("deck not found");
  });
});

describe("fetchDueCount", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns due counts from a single-deck getDeckStats call", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            "123": { deck_id: 123, name: "Verbs", new_count: 5, learn_count: 3, review_count: 10 },
          },
          error: null,
        }),
      ),
    );

    const due = await fetchDueCount("Spanish::Verbs");
    expect(due).toEqual({ new: 5, learn: 3, review: 10 });
  });

  it("returns zeros when the request fails", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const due = await fetchDueCount("Missing");
    expect(due).toEqual({ new: 0, learn: 0, review: 0 });
  });
});

describe("fetchAllDueCounts", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps batched getDeckStats back to full deck names via deck ids", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    // One batched getDeckStats (keyed by id, leaf names) + one deckNamesAndIds.
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              "1": { deck_id: 1, name: "Spanish", new_count: 10, learn_count: 0, review_count: 5 },
              "2": { deck_id: 2, name: "Verbs", new_count: 3, learn_count: 1, review_count: 2 },
            },
            error: null,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { Spanish: 1, "Spanish::Verbs": 2 },
            error: null,
          }),
        ),
      );

    const counts = await fetchAllDueCounts(["Spanish", "Spanish::Verbs"]);

    // Keys must be the full deck names, not the leaf names returned by AnkiConnect
    expect(counts["Spanish"]).toEqual({ new: 10, learn: 0, review: 5 });
    expect(counts["Spanish::Verbs"]).toEqual({ new: 3, learn: 1, review: 2 });
    expect(counts["Verbs"]).toBeUndefined();
    // Two requests total, no matter how many decks.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns zeroed counts for every deck when the stats request fails", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValue(new Error("network error"));

    const counts = await fetchAllDueCounts(["Spanish", "Spanish::Verbs"]);

    expect(counts["Spanish"]).toEqual({ new: 0, learn: 0, review: 0 });
    expect(counts["Spanish::Verbs"]).toEqual({ new: 0, learn: 0, review: 0 });
  });
});

describe("fetchAllNoteCounts", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts notes per deck, keyed by full deck name", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    // One findNotes per deck; `deck:` matches descendants, so a parent's query
    // already returns its subdecks' notes (no client-side rollup needed).
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [1, 2, 3, 4, 5], error: null })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [4, 5], error: null })),
      );

    const counts = await fetchAllNoteCounts(["Spanish", "Spanish::Verbs"]);

    expect(counts["Spanish"]).toBe(5);
    expect(counts["Spanish::Verbs"]).toBe(2);
  });

  it("returns 0 for a deck whose request fails, without failing the rest", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [1, 2], error: null })),
      )
      .mockRejectedValueOnce(new Error("network error"));

    const counts = await fetchAllNoteCounts(["Spanish", "Spanish::Verbs"]);

    expect(counts["Spanish"]).toBe(2);
    expect(counts["Spanish::Verbs"]).toBe(0);
  });
});
