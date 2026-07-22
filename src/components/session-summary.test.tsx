// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionSummary, type SessionAnswer } from "./session-summary";
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

describe("SessionSummary", () => {
  it("reports the reviewed count, accuracy, and total time with per-card", () => {
    render(<SessionSummary answers={ANSWERS} elapsedMs={92_000} extraReviews={0} />);

    expect(screen.getByText("Reviewed")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    // 3 of 4 graded better than Again.
    expect(screen.getByText("75%")).toBeTruthy();
    // 92s total → "1m 32s"; 92s / 4 = 23s per card, captioned on the Time tile.
    expect(screen.getByText("1m 32s")).toBeTruthy();
    expect(screen.getByText("23s / card")).toBeTruthy();
  });

  it("captions the reviewed tile with the repeat count", () => {
    render(<SessionSummary answers={ANSWERS} elapsedMs={5_000} extraReviews={2} />);
    expect(screen.getByText("+2 repeats")).toBeTruthy();
  });

  it("omits the repeat caption when there were none", () => {
    render(<SessionSummary answers={ANSWERS} elapsedMs={5_000} extraReviews={0} />);
    expect(screen.queryByText(/repeat/)).toBeNull();
  });

  it("shows each grade that occurred in the distribution legend", () => {
    render(<SessionSummary answers={ANSWERS} elapsedMs={5_000} extraReviews={0} />);

    // Again/Good/Easy occurred; Hard did not, so it's omitted from the legend.
    expect(screen.getByText("Again")).toBeTruthy();
    expect(screen.getByText("Good")).toBeTruthy();
    expect(screen.getByText("Easy")).toBeTruthy();
    expect(screen.queryByText("Hard")).toBeNull();
  });

  it("rounds sub-minute sessions to seconds", () => {
    render(<SessionSummary answers={ANSWERS} elapsedMs={45_400} extraReviews={0} />);
    expect(screen.getByText("45s")).toBeTruthy(); // total
    expect(screen.getByText("11s / card")).toBeTruthy(); // 45.4s / 4 ≈ 11s
  });

  it("shows the recent-accuracy sparkline once enough history lands", () => {
    render(
      <SessionSummary
        answers={ANSWERS}
        elapsedMs={5_000}
        extraReviews={0}
        history={HISTORY}
      />,
    );
    expect(screen.getByText("Recent accuracy")).toBeTruthy();
    expect(screen.getByText("last 3 days")).toBeTruthy();
  });

  it("hides the sparkline while history is loading or too short to plot", () => {
    const { rerender } = render(
      <SessionSummary answers={ANSWERS} elapsedMs={5_000} extraReviews={0} history={null} />,
    );
    expect(screen.queryByText("Recent accuracy")).toBeNull();

    // A single day isn't a trend.
    rerender(
      <SessionSummary
        answers={ANSWERS}
        elapsedMs={5_000}
        extraReviews={0}
        history={[HISTORY[0]]}
      />,
    );
    expect(screen.queryByText("Recent accuracy")).toBeNull();
  });
});
