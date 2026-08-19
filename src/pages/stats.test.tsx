// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatsPage } from "./stats";
import type { CollectionStats } from "@/lib/stats";

const { fetchStatsMock } = vi.hoisted(() => ({ fetchStatsMock: vi.fn() }));
vi.mock("@/lib/stats", () => ({ fetchCollectionStats: fetchStatsMock }));
vi.mock("@/hooks/use-deck-names", () => ({
  useDeckNames: () => ["Spanish", "Spanish::Verbs"],
}));
vi.mock("@/lib/sync-context", () => ({
  useSync: () => ({
    syncedAt: 0,
    refreshedAt: 0,
    registerPageLoad: () => () => {},
  }),
}));

const day = (offset: number) => new Date(2026, 5, 15 + offset).getTime();

// Formatted the same way the page does, so the assertions hold under any
// runtime locale rather than assuming a day-first or month-first order.
const axisDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const axisMonth = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short" });

/** The heatmap's own subtree — month names also appear on the trend axis. */
const heatmap = () =>
  screen.getByRole("img", { name: /over the past year/i }).parentElement!;

const days = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    dayMs: day(-(count - 1 - i)),
    reviews: i % 4,
    passes: i % 3,
    seconds: 30,
  }));

const stats = (over: Partial<CollectionStats> = {}): CollectionStats => ({
  totals: { reviews: 1200, seconds: 7200, firstReviewAt: day(-300), cardsSeen: 84 },
  streak: {
    current: 12,
    longest: 40,
    studiedToday: true,
    lastStudiedDay: day(0),
    activeDays: 200,
  },
  heatmapDays: days(365),
  recentDays: days(30),
  retention: {
    young: { reviews: 400, passes: 340, rate: 0.85 },
    mature: { reviews: 300, passes: 279, rate: 0.93 },
    overall: { reviews: 700, passes: 619, rate: 0.884 },
  },
  retentionTrend: [
    { startMs: day(-60), young: { reviews: 1, passes: 1, rate: 1 }, mature: { reviews: 0, passes: 0, rate: null }, overall: { reviews: 1, passes: 1, rate: 1 } },
    { startMs: day(-30), young: { reviews: 2, passes: 1, rate: 0.5 }, mature: { reviews: 0, passes: 0, rate: null }, overall: { reviews: 2, passes: 1, rate: 0.5 } },
  ],
  forecast: Array.from({ length: 30 }, (_, i) => ({
    dayOffset: i,
    due: 10 + i,
    minutes: (10 + i) * 0.5,
  })),
  forecastAnchorMs: day(0),
  hardest: [
    {
      noteId: 100,
      front: "el perro",
      deckName: "Spanish::Verbs",
      lapses: 4,
      reviews: 12,
      seconds: 300,
    },
  ],
  medianAnswerSeconds: 30,
  partial: false,
  ...over,
});

const renderPage = (entry = "/stats") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <StatsPage />
    </MemoryRouter>,
  );

describe("StatsPage", () => {
  beforeEach(() => {
    fetchStatsMock.mockReset();
  });
  afterEach(cleanup);

  it("renders the headline figures", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    renderPage();

    // The accent is the "kept today" signal, so it's on in the fixture's
    // studied-today state and nowhere else.
    expect((await screen.findByText("12")).className).toContain("#2563eb");
    // Today is banked, so the accent carries that and the line is free to
    // report the longest streak rather than repeat it.
    expect(screen.getByText("Longest streak 40")).toBeTruthy();
    // The accent is the only visible "banked" signal, and colour is what a
    // screen reader can't relay — so the state is still said out loud there.
    const banked = screen.getByText("Studied today.");
    expect(banked.className).toContain("sr-only");
    expect(screen.getByText("1,200")).toBeTruthy(); // lifetime reviews
    expect(screen.getByText("2 h")).toBeTruthy();
    expect(screen.getByText("88%")).toBeTruthy(); // overall retention
  });

  // The whole point of the sub-line: a streak that counts yesterday looks
  // identical to one banked today, and only one of them can still be lost.
  it("keeps the streak number grey while today is still owed", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        streak: {
          current: 12,
          longest: 40,
          studiedToday: false,
          lastStudiedDay: day(-1),
          activeDays: 200,
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText("Not studied today · longest 40"),
    ).toBeTruthy();
    // The accent reads as "kept", so it stays off until today is banked: the
    // number is grey while the streak can still be lost today.
    const value = screen.getByText("12");
    expect(value.className).toContain("text-muted-foreground");
    expect(value.className).not.toContain("#2563eb");
  });

  // Under a deck filter the whole tile is deck-scoped — label and hint say so,
  // and the sub-line must too. A day spent on other decks isn't a day studied
  // here, so a flat "Not studied today" would be a claim about the collection
  // that the number underneath it isn't making.
  it("scopes today's state to the deck when one is selected", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        streak: {
          current: 12,
          longest: 40,
          studiedToday: false,
          lastStudiedDay: day(-1),
          activeDays: 200,
        },
      }),
    );
    renderPage("/stats?deck=Spanish");

    expect(
      await screen.findByText("Not studied here today · longest 40"),
    ).toBeTruthy();
  });

  // Grey means "today isn't done" — not "a streak is at risk". A broken streak
  // is the same unlit state as an unkept one, so the tile answers the question
  // there too rather than going silent on it.
  it("still states today when there's no streak running", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        streak: {
          current: 0,
          longest: 40,
          studiedToday: false,
          lastStudiedDay: day(-9),
          activeDays: 200,
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText("Not studied today · longest 40"),
    ).toBeTruthy();
    expect(screen.getByText("0").className).toContain("text-muted-foreground");
  });

  // An unstudied today is the faintest heat step there is — without a marker
  // it's indistinguishable from the padding after the last column.
  it("rings today's heatmap cell and names it in the tooltip", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    renderPage();
    await screen.findByText("Activity");

    const cells = heatmap().querySelectorAll<HTMLElement>('[data-tip^="Today ·"]');
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain("ring-");
  });

  // A small deck scope has real study time but under an hour; rounding to
  // hours showed "0 h" above a non-zero card count.
  it("shows minutes on the Time tile below an hour", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        totals: { reviews: 40, seconds: 900, firstReviewAt: day(-30), cardsSeen: 12 },
      }),
    );
    renderPage();

    expect(await screen.findByText("15 min")).toBeTruthy();
    expect(screen.queryByText("0 h")).toBeNull();
  });

  it("labels the streak with the deck once one is selected", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    renderPage();

    expect(await screen.findByText("Current streak")).toBeTruthy();
  });

  // An empty bucket is unknown, not zero — the page must not print "0%".
  it("shows a dash for a retention bucket with no reviews", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        retention: {
          young: { reviews: 10, passes: 9, rate: 0.9 },
          mature: { reviews: 0, passes: 0, rate: null },
          overall: { reviews: 10, passes: 9, rate: 0.9 },
        },
      }),
    );
    renderPage();

    await screen.findByText("Retention by card age");
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("degrades the forecast block on its own rather than the page", async () => {
    fetchStatsMock.mockResolvedValue(stats({ forecast: null }));
    renderPage();

    expect(
      await screen.findByText(/couldn't read the upcoming schedule/i),
    ).toBeTruthy();
    // The rest of the page is still there.
    expect(screen.getByText("Retention by card age")).toBeTruthy();
  });

  it("warns when only part of the collection could be read", async () => {
    fetchStatsMock.mockResolvedValue(stats({ partial: true }));
    renderPage();

    expect(await screen.findByText(/figures are incomplete/i)).toBeTruthy();
  });

  it("invites the user to study when there's no history", async () => {
    fetchStatsMock.mockResolvedValue(
      stats({
        totals: { reviews: 0, seconds: 0, firstReviewAt: null, cardsSeen: 0 },
      }),
    );
    renderPage();

    expect(await screen.findByText(/no review history here yet/i)).toBeTruthy();
  });

  it("surfaces a total failure as a connection error", async () => {
    fetchStatsMock.mockRejectedValue(new Error("Anki is not running"));
    renderPage();

    await waitFor(() => {
      expect(fetchStatsMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Retention by card age")).toBeNull();
  });

  it("reads the whole collection until a deck is picked", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    const { getByLabelText } = renderPage();

    await screen.findByText("Retention by card age");
    expect(getByLabelText("Filter stats by deck").textContent).toContain(
      "All decks",
    );
    expect(fetchStatsMock).toHaveBeenCalledWith({
      deckName: undefined,
      cacheKey: 0,
    });
  });

  // How a deck links to its own stats: the decks-list menu and the deck page's
  // menu both open /stats?deck=…, so the page must start scoped there.
  it("opens scoped to the deck named in the URL", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    const { getByLabelText } = renderPage("/stats?deck=Spanish%3A%3AVerbs");

    await screen.findByText("Retention by card age");
    expect(fetchStatsMock).toHaveBeenCalledWith({
      deckName: "Spanish::Verbs",
      cacheKey: 0,
    });
    expect(getByLabelText("Filter stats by deck").textContent).toContain(
      "Verbs",
    );
  });

  // The jargon tiles carry plain-language hover hints (spec §11.2 requires
  // the retention one). The Tooltip keeps its content in the DOM, so presence
  // is assertable without simulating hover.
  describe("explanatory hints", () => {
    it("explains why Retention reads lower than session accuracy", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();

      expect(
        await screen.findByText(/learning steps don't count/i),
      ).toBeTruthy();
    });

    it("names the ~90% target", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Retention by card age");

      expect(screen.getAllByText(/around 90%/i).length).toBeGreaterThan(0);
    });

    it("explains the young/mature split", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Retention by card age");

      expect(screen.getByText(/some misses here are normal/i)).toBeTruthy();
      expect(screen.getByText(/truer test of long-term memory/i)).toBeTruthy();
    });

    it("pluralises the minutes estimate correctly at one minute", async () => {
      // "13 cards due today · about 1 minutes" shipped once; rounding must
      // happen before the noun is chosen.
      fetchStatsMock.mockResolvedValue(
        stats({
          forecast: [
            { dayOffset: 0, due: 13, minutes: 1.2 },
            ...Array.from({ length: 29 }, (_, i) => ({
              dayOffset: i + 1,
              due: 5,
              minutes: 2.5,
            })),
          ],
        }),
      );
      renderPage();
      await screen.findByText("Coming up");

      expect(screen.getByText(/about 1 minute$/)).toBeTruthy();
      expect(screen.queryByText(/about 1 minutes/)).toBeNull();
    });

    it("says 'less than a minute' rather than 'about 0 minutes'", async () => {
      fetchStatsMock.mockResolvedValue(
        stats({
          forecast: [
            { dayOffset: 0, due: 1, minutes: 0.3 },
            ...Array.from({ length: 29 }, (_, i) => ({
              dayOffset: i + 1,
              due: 5,
              minutes: 2.5,
            })),
          ],
        }),
      );
      renderPage();
      await screen.findByText("Coming up");

      expect(screen.getByText(/less than a minute/)).toBeTruthy();
    });

    it("explains the forecast's minutes estimate", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Coming up");

      expect(
        screen.getByText(/typical answer time over the last 30 days/i),
      ).toBeTruthy();
    });
  });

  describe("trouble spots", () => {
    it("lists failing notes with their tallies, linking to the note itself", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Trouble spots");

      expect(screen.getByText("el perro")).toBeTruthy();
      expect(screen.getByText(/4 lapses/)).toBeTruthy();
      const link = screen.getByText("el perro").closest("a");
      // The note id rides along so the deck page can open its editor — the
      // fix-list points at work, and the work is editing the note.
      expect(link?.getAttribute("href")).toBe(
        `/decks/${encodeURIComponent("Spanish::Verbs")}?note=100`,
      );
    });

    // The all-clear renders rather than the block vanishing, so its absence
    // never reads as "nothing was checked".
    it("celebrates an empty fix-list", async () => {
      fetchStatsMock.mockResolvedValue(stats({ hardest: [] }));
      renderPage();

      expect(
        await screen.findByText(/nothing is repeatedly tripping you up/i),
      ).toBeTruthy();
    });

    it("degrades on its own when the notes can't be read", async () => {
      fetchStatsMock.mockResolvedValue(stats({ hardest: null }));
      renderPage();

      expect(
        await screen.findByText(/couldn't read these cards/i),
      ).toBeTruthy();
      expect(screen.getByText("Coming up")).toBeTruthy();
    });
  });

  describe("horizontal axes", () => {
    // A label on every one of 30 bars is unreadable, so the axis ticks weekly.
    it("ticks the 30-day chart weekly, ending on today", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText(/Reviews per day/);

      // recentDays runs to day(0); weekly ticks back from there.
      for (const offset of [-7, -14, -21, -28]) {
        expect(screen.getAllByText(axisDate(day(offset))).length).toBeGreaterThan(0);
      }
      // The final tick is named rather than dated — matching a date against
      // your own sense of the date is the work this chart shouldn't ask for.
      expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
      expect(screen.queryByText(axisDate(day(0)))).toBeNull();
      // Not a label per bar — the day between two ticks stays blank.
      expect(screen.queryByText(axisDate(day(-1)))).toBeNull();
    });

    it("labels every month on the retention trend", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText(/By month/);

      // The fixture trend has two points: day(-60) and day(-30).
      for (const offset of [-60, -30]) {
        expect(screen.getAllByText(axisMonth(day(offset))).length).toBeGreaterThan(0);
      }
    });

    // A fixed 0-100% axis with no gridline reads as "nearly full" at 88%.
    it("states the retention scale", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();

      expect(await screen.findByText("By month (0–100%)")).toBeTruthy();
    });

    // A forecast answers "when does this start", so its axis anchors on day 0
    // rather than on the far end like the backward-looking charts.
    it("anchors the forecast axis on today", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Coming up");

      expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
    });

    // The dates must derive from the data's own anchor, never the render-time
    // clock: a cached forecast viewed after midnight would otherwise put every
    // bar under the following day's label. The fixture anchor is a fixed past
    // date, so this fails if the component reaches for Date.now().
    it("derives forecast dates from the fetch-time anchor, not the clock", async () => {
      fetchStatsMock.mockResolvedValue(stats());
      renderPage();
      await screen.findByText("Coming up");

      for (const offset of [7, 14, 21, 28]) {
        expect(
          screen.getAllByText(axisDate(day(offset))).length,
        ).toBeGreaterThan(0);
      }
    });
  });

  // Days 1-7 straddle two Monday-aligned columns whenever a month doesn't
  // start on a Monday, which used to label the same month twice: the header
  // read "Aug Aug Sep Oct Oct Nov Nov".
  it("labels each month in the heatmap exactly once", async () => {
    fetchStatsMock.mockResolvedValue(stats());
    renderPage();
    await screen.findByText("Activity");

    const months = Array.from({ length: 12 }, (_, m) =>
      axisMonth(new Date(2026, m, 1).getTime()),
    );
    // Scoped to the heatmap: the retention trend has its own month axis.
    const inHeatmap = within(heatmap());
    for (const month of months) {
      expect(inHeatmap.queryAllByText(month).length).toBeLessThanOrEqual(1);
    }
    // A 365-day window spans 12 or 13 month boundaries; the doubling bug
    // pushed this past 20.
    const labelled = months.filter(
      (m) => inHeatmap.queryAllByText(m).length === 1,
    );
    expect(labelled.length).toBeGreaterThanOrEqual(11);
  });

  // Switching decks used to look like nothing had happened: the figures stayed
  // put with no sign a fetch was running.
  it("keeps the old figures visible and marks them busy while a deck loads", async () => {
    fetchStatsMock.mockResolvedValueOnce(stats());
    const { getByLabelText, container } = renderPage();
    await screen.findByText("Retention by card age");

    // A request that never settles, so the pending state is observable.
    fetchStatsMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(getByLabelText("Filter stats by deck"));
    fireEvent.click(screen.getByRole("option", { name: /^Spanish$/ }));

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
    // The previous deck's numbers are still readable rather than blanked.
    expect(screen.getByText("1,200")).toBeTruthy();
    expect(fetchStatsMock).toHaveBeenLastCalledWith({
      deckName: "Spanish",
      cacheKey: 0,
    });
  });
});
