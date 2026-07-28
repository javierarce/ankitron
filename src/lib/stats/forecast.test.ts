import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachEstimatedMinutes,
  computeMedianAnswerSeconds,
  fetchForecastCounts,
  forecastQuery,
} from "./forecast";
import { REVLOG_TYPE, type RevlogEntry } from "./revlog";

const { ankiFetchMock, ankiMultiMock } = vi.hoisted(() => ({
  ankiFetchMock: vi.fn(),
  ankiMultiMock: vi.fn(),
}));
vi.mock("../anki-fetch", () => ({
  ankiFetch: ankiFetchMock,
  ankiMulti: ankiMultiMock,
}));

const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

const entry = (over: Partial<RevlogEntry> & { id: number }): RevlogEntry => ({
  cardId: 1,
  ease: 3,
  ivl: 30,
  lastIvl: 10,
  factor: 2500,
  timeMs: 2000,
  type: REVLOG_TYPE.review,
  deck: "Spanish",
  ...over,
});

/** `count` reviews, all just now, each taking `timeMs`. */
const samples = (count: number, timeMs: number): RevlogEntry[] =>
  Array.from({ length: count }, (_, i) => entry({ id: now - i, timeMs }));

describe("forecastQuery", () => {
  // The backlog is part of today's workload, not a separate number the user
  // has to add on themselves.
  it("folds overdue cards into day 0", () => {
    expect(forecastQuery(0)).toBe("prop:due<=0 -is:suspended");
  });

  it("asks for an exact day thereafter", () => {
    expect(forecastQuery(3)).toBe("prop:due=3 -is:suspended");
  });

  it("scopes to a deck when one is selected", () => {
    expect(forecastQuery(1, "Spanish::Verbs")).toBe(
      'deck:"Spanish::Verbs" prop:due=1 -is:suspended',
    );
  });
});

describe("computeMedianAnswerSeconds", () => {
  it("takes the middle of an odd sample count", () => {
    const entries = [...samples(20, 2000), entry({ id: now, timeMs: 10_000 })];

    expect(computeMedianAnswerSeconds(entries, now - 86_400_000)).toBe(2);
  });

  it("averages the two middles of an even sample count", () => {
    const entries = [...samples(10, 2000), ...samples(10, 4000)];

    expect(computeMedianAnswerSeconds(entries, now - 86_400_000)).toBe(3);
  });

  // Anki caps a single answer at 60s, so every walk-away lands on the cap. A
  // mean would follow them; the median must not.
  it("ignores walk-away outliers", () => {
    const entries = [...samples(19, 2000), entry({ id: now, timeMs: 60_000 })];

    expect(computeMedianAnswerSeconds(entries, now - 86_400_000)).toBe(2);
  });

  it("returns null below the sample threshold rather than guessing", () => {
    expect(computeMedianAnswerSeconds(samples(5, 2000), now - 86_400_000)).toBeNull();
  });

  it("counts only scheduled reviews inside the window", () => {
    const entries = [
      ...samples(19, 2000),
      ...Array.from({ length: 20 }, (_, i) =>
        entry({ id: now - i, type: REVLOG_TYPE.learning }),
      ),
    ];

    // 19 scheduled reviews is still under the threshold; the learning steps
    // must not top it up.
    expect(computeMedianAnswerSeconds(entries, now - 86_400_000)).toBeNull();
  });

  it("excludes reviews older than the window", () => {
    const old = samples(30, 2000).map((e) => ({
      ...e,
      id: e.id - 90 * 86_400_000,
    }));

    expect(computeMedianAnswerSeconds(old, now - 86_400_000)).toBeNull();
  });
});

describe("fetchForecastCounts", () => {
  beforeEach(() => {
    ankiMultiMock.mockClear();
  });

  // One round trip for the whole month: AnkiConnect serialises on Anki's main
  // thread, so a per-day fan-out visibly stalls the page.
  it("asks for every day in a single batched request", async () => {
    ankiMultiMock.mockImplementation(
      async (actions: { params: { query: string } }[]) =>
        actions.map((a) => ({
          ok: true,
          value: a.params.query.includes("<=0") ? [1, 2, 3] : [9],
        })),
    );

    const result = await fetchForecastCounts(3);

    expect(ankiMultiMock).toHaveBeenCalledTimes(1);
    expect(ankiMultiMock.mock.calls[0][0]).toHaveLength(3);
    expect(result).toEqual([
      { dayOffset: 0, due: 3 },
      { dayOffset: 1, due: 1 },
      { dayOffset: 2, due: 1 },
    ]);
  });

  // A forecast with one silently-zero day is a chart that lies.
  it("rejects when the batch fails", async () => {
    ankiMultiMock.mockRejectedValue(new Error("Anki is not running"));

    await expect(fetchForecastCounts(3)).rejects.toThrow();
  });

  // `multi` reports a failed sub-action in-band rather than rejecting, so a
  // single bad day must not quietly become a zero.
  it("rejects when one day in the batch comes back as an error", async () => {
    ankiMultiMock.mockResolvedValue([
      { ok: true, value: [1, 2] },
      { ok: false, error: "Invalid search: expected a whole number" },
      { ok: true, value: [3] },
    ]);

    await expect(fetchForecastCounts(3)).rejects.toThrow(
      /could not read the upcoming schedule/i,
    );
  });
});

describe("attachEstimatedMinutes", () => {
  it("estimates from the median answer time", () => {
    const result = attachEstimatedMinutes([{ dayOffset: 0, due: 60 }], 5);

    expect(result[0].minutes).toBe(5); // 60 cards × 5s = 300s
  });

  it("leaves minutes null when there's no timing history", () => {
    const result = attachEstimatedMinutes([{ dayOffset: 0, due: 60 }], null);

    expect(result[0]).toEqual({ dayOffset: 0, due: 60, minutes: null });
  });
});
