// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SessionSummary,
  type AccuracyHistory,
  type SessionAnswer,
} from "./session-summary";
import type { DailyAccuracy } from "@/lib/session-history";

afterEach(cleanup);

// 4 answers, one of them Again → 75% accuracy.
const ANSWERS: SessionAnswer[] = [
  { cardId: 1, ease: 3 },
  { cardId: 2, ease: 1 },
  { cardId: 3, ease: 3 },
  { cardId: 4, ease: 4 },
];

const HISTORY: DailyAccuracy[] = [
  { dayMs: 1, total: 10, accuracy: 0.7 },
  { dayMs: 2, total: 8, accuracy: 0.8 },
  { dayMs: 3, total: 4, accuracy: 0.75 },
];

const ready = (days: DailyAccuracy[]): AccuracyHistory => ({
  status: "ready",
  days,
});

// The stats above the sparkline come from the answer log alone, so most tests
// don't care what the trend is doing — default to a plotted chart.
function renderSummary(props: {
  elapsedMs?: number;
  extraReviews?: number;
  history?: AccuracyHistory;
} = {}) {
  return render(
    <SessionSummary
      answers={ANSWERS}
      elapsedMs={props.elapsedMs ?? 5_000}
      extraReviews={props.extraReviews ?? 0}
      history={props.history ?? ready(HISTORY)}
    />,
  );
}

describe("SessionSummary", () => {
  it("reports the reviewed count, accuracy, and total time with per-card", () => {
    renderSummary({ elapsedMs: 92_000 });

    expect(screen.getByText("Reviewed")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    // 3 of 4 graded better than Again.
    expect(screen.getByText("75%")).toBeTruthy();
    // 92s total → "1m 32s"; 92s / 4 = 23s per card, captioned on the Time tile.
    expect(screen.getByText("1m 32s")).toBeTruthy();
    expect(screen.getByText("23s / card")).toBeTruthy();
  });

  it("captions the reviewed tile with the repeat count", () => {
    renderSummary({ extraReviews: 2 });
    expect(screen.getByText("+2 repeats")).toBeTruthy();
  });

  it("omits the repeat caption when there were none", () => {
    renderSummary();
    expect(screen.queryByText(/repeat/)).toBeNull();
  });

  it("shows each grade that occurred in the distribution legend", () => {
    renderSummary();

    // Again/Good/Easy occurred; Hard did not, so it's omitted from the legend.
    expect(screen.getByText("Again")).toBeTruthy();
    expect(screen.getByText("Good")).toBeTruthy();
    expect(screen.getByText("Easy")).toBeTruthy();
    expect(screen.queryByText("Hard")).toBeNull();
  });

  it("rounds sub-minute sessions to seconds", () => {
    renderSummary({ elapsedMs: 45_400 });
    expect(screen.getByText("45s")).toBeTruthy(); // total
    expect(screen.getByText("11s / card")).toBeTruthy(); // 45.4s / 4 ≈ 11s
  });

  describe("the accuracy trend slot", () => {
    // The heading is part of the fixed frame, so it is present in every state —
    // that's what keeps the slot (and the card) from changing height.
    it("keeps the heading in every state", () => {
      for (const history of [
        { status: "loading" } as const,
        { status: "error" } as const,
        ready(HISTORY),
        ready([HISTORY[0]]),
        ready([]),
      ]) {
        const { unmount } = renderSummary({ history });
        expect(screen.getByText("Recent accuracy")).toBeTruthy();
        unmount();
      }
    });

    it("plots the chart once enough days land", () => {
      renderSummary({ history: ready(HISTORY) });
      expect(screen.getByText("last 3 days")).toBeTruthy();
      expect(screen.queryByTestId("sparkline-skeleton")).toBeNull();
      expect(screen.queryByTestId("sparkline-empty")).toBeNull();
      expect(screen.queryByTestId("sparkline-error")).toBeNull();
    });

    it("shows a skeleton while the history is loading", () => {
      renderSummary({ history: { status: "loading" } });
      expect(screen.getByTestId("sparkline-skeleton")).toBeTruthy();
      // The day count belongs to a plotted chart only.
      expect(screen.queryByText(/^last /)).toBeNull();
    });

    it("swaps the skeleton for the chart in place when the history lands", () => {
      const { rerender } = render(
        <SessionSummary
          answers={ANSWERS}
          elapsedMs={5_000}
          extraReviews={0}
          history={{ status: "loading" }}
        />,
      );
      const skeleton = screen.getByTestId("sparkline-skeleton");

      rerender(
        <SessionSummary
          answers={ANSWERS}
          elapsedMs={5_000}
          extraReviews={0}
          history={ready(HISTORY)}
        />,
      );
      expect(screen.queryByTestId("sparkline-skeleton")).toBeNull();
      expect(screen.getByText("last 3 days")).toBeTruthy();

      // The chart fades in rather than cutting in. A CSS entrance animation
      // only runs on a fresh node, so assert both the class and that the
      // skeleton's element wasn't reused to carry it.
      const chart = screen.getByRole("img", {
        name: /accuracy over the last/i,
      });
      const body = chart.parentElement;
      expect(body?.className).toContain("fade-in");
      expect(body).not.toBe(skeleton);
    });

    it("explains that a single day isn't enough to plot", () => {
      renderSummary({ history: ready([HISTORY[0]]) });
      expect(screen.getByTestId("sparkline-empty")).toBeTruthy();
      expect(screen.queryByTestId("sparkline-skeleton")).toBeNull();
    });

    // A failed read must never borrow the not-enough-history copy: telling a
    // user with months of reviews to "study on another day" is a lie, and the
    // failure resolves to zero days, so this is the case that would regress.
    it("reports a failed read as an error, not as an empty history", () => {
      renderSummary({ history: { status: "error" } });

      expect(screen.getByTestId("sparkline-error")).toBeTruthy();
      expect(screen.queryByTestId("sparkline-empty")).toBeNull();
      expect(screen.queryByTestId("sparkline-skeleton")).toBeNull();
      expect(screen.queryByText(/study this deck on another day/i)).toBeNull();
    });

    it("treats a genuinely empty history as too short to plot", () => {
      renderSummary({ history: ready([]) });
      expect(screen.getByTestId("sparkline-empty")).toBeTruthy();
      expect(screen.queryByTestId("sparkline-error")).toBeNull();
    });
  });
});
