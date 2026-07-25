import { useMemo, type ReactNode } from "react";
import type { Ease } from "@/lib/types";
import type { DailyAccuracy } from "@/lib/session-history";
import { GradeDistribution } from "./grade-distribution";
import { AccuracySparkline } from "./accuracy-sparkline";
import { Tooltip } from "./tooltip";

// A trend needs at least two points to read as anything but a dot.
const MIN_TREND_DAYS = 2;

/** One graded answer from a study session — the card and the button pressed. */
export interface SessionAnswer {
  cardId: number;
  ease: Ease;
}

/**
 * The recent-accuracy trend's load state. A tagged union rather than a bare
 * array because "still loading", "we couldn't read it" and "there genuinely
 * isn't enough yet" are three different things to say to the user — an array
 * alone can't tell the last two apart, and an errored read that looks like an
 * empty one would have the card claim the user has no study history.
 */
export type AccuracyHistory =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; days: readonly DailyAccuracy[] };

// A headline stat tile, matching the note-stats panel's tiles so the two stat
// surfaces read the same. `note` is an optional caption under the value.
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5 text-left">
      <div className="text-xs text-foreground/50">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {note != null && (
        <div className="mt-0.5 text-[11px] leading-tight text-foreground/40">
          {note}
        </div>
      )}
    </div>
  );
}

// The fixed shell every state of the accuracy trend renders into: the heading
// row and the canvas beneath it. Owning both here is what makes the card hold
// its height — the chart, the loading skeleton and the two message states are
// laid out by this one definition, so they cannot drift into different heights
// the way three hand-matched copies of the same Tailwind classes can. (An
// earlier version did exactly that and was 4px short while loading.)
//
// The heading is always the real one: it's known before the data is, so there's
// nothing to placeholder. Only `aside` (the day count) and the body swap.
function SparklineFrame({
  aside,
  children,
}: {
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-foreground/40">
          Recent accuracy
        </h4>
        {aside}
      </div>
      <div className="relative h-28 w-full">{children}</div>
    </section>
  );
}

// A short explanation filling the canvas — used when there's no chart to draw
// (too little history, or we couldn't read it). Matches the note-stats panel's
// empty treatment so the two stat surfaces read as one family.
function SparklineNotice({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-foreground/[0.02] px-6 text-center text-xs text-foreground/60"
    >
      {children}
    </div>
  );
}

// The loading shim. motion-safe so a reduced-motion user gets a still block
// rather than an indefinite pulse; role=status announces the wait to assistive
// tech, which an aria-hidden block would leave silent before content appears.
function SparklineSkeleton() {
  return (
    <div
      role="status"
      data-testid="sparkline-skeleton"
      className="h-full w-full rounded-lg bg-foreground/[0.04] motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading your recent accuracy…</span>
    </div>
  );
}

/** A session's wall-clock length as "45s" / "4m" / "4m 32s". */
function formatSessionTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * The end-of-session recap: how many cards were graded, how well, how long it
 * took, and the spread of answer buttons. Built entirely from the client-side
 * answer log the study page keeps, so it needs no extra AnkiConnect round trip.
 */
export function SessionSummary({
  answers,
  elapsedMs,
  extraReviews,
  history,
}: {
  answers: readonly SessionAnswer[];
  elapsedMs: number;
  /**
   * Answers beyond the number of cards originally due — cards that came back
   * around after an Again press. Shown as a caption on the Reviewed tile so the
   * count above it doesn't look inflated relative to the deck's due count.
   */
  extraReviews: number;
  /**
   * This deck's recent per-day accuracy, for the trend sparkline, fetched after
   * the session ends. Required and explicitly tagged (see AccuracyHistory): the
   * slot always renders, at a constant height, showing a skeleton while the read
   * is in flight, the chart once there are enough days to plot, and a short
   * notice when there aren't — or when the read failed.
   */
  history: AccuracyHistory;
}) {
  const counts = useMemo(() => {
    const c = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const a of answers) {
      if (a.ease === 1) c.again++;
      else if (a.ease === 2) c.hard++;
      else if (a.ease === 3) c.good++;
      else if (a.ease === 4) c.easy++;
    }
    return c;
  }, [answers]);

  const total = answers.length;
  // Accuracy mirrors the note panel's success rate: the share of answers graded
  // better than Again. Undefined with nothing to divide.
  const accuracy = total > 0 ? (total - counts.again) / total : null;
  // Average answering time — the session's wall-clock spread over its answers.
  const perCardMs = total > 0 ? elapsedMs / total : 0;

  // The days to plot, or null when there's no chart to draw (still loading,
  // the read failed, or a single day — which reads as a dot, not a trend).
  // Derived once so the heading's day count and the body can't disagree.
  const trend =
    history.status === "ready" && history.days.length >= MIN_TREND_DAYS
      ? history.days
      : null;

  return (
    <div className="mx-auto w-fit space-y-6 rounded-xl border border-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      {/* Fixed-width tiles (rather than fractions of the container) set the
          summary's overall width — three 120px cards + gaps — and the graph
          sections below fill it. */}
      <div className="grid grid-cols-[repeat(3,120px)] gap-3">
        <Stat
          label="Reviewed"
          value={String(total)}
          note={
            extraReviews > 0 ? (
              <Tooltip
                content="Cards you answered Again came back later in the session, so you graded more times than the number that were due."
                side="top"
                wide
              >
                <span className="cursor-help border-b border-dotted border-foreground/30">
                  +{extraReviews} {extraReviews === 1 ? "repeat" : "repeats"}
                </span>
              </Tooltip>
            ) : undefined
          }
        />
        <Stat
          label="Accuracy"
          value={accuracy == null ? "—" : `${Math.round(accuracy * 100)}%`}
        />
        <Stat
          label="Time"
          value={formatSessionTime(elapsedMs)}
          note={total > 0 ? `${formatSessionTime(perCardMs)} / card` : undefined}
        />
      </div>

      {/* The trend graph sits above the answer bar, matching the note-stats
          card's order (history chart over the distribution). SparklineFrame
          fixes the slot's height across all four states, so the card — and the
          title and buttons the study page stacks around it — never move when the
          read lands. A failed read says so rather than borrowing the
          not-enough-history copy, which would tell a user with months of
          reviews that they've never studied. */}
      <div className="text-left">
        <SparklineFrame
          aside={
            trend && (
              // Lands with the chart, so it fades on the same beat rather than
              // appearing beside a chart that's still fading up.
              <span className="fade-in text-xs tabular-nums text-foreground/50">
                last {trend.length} days
              </span>
            )
          }
        >
          {history.status === "loading" ? (
            <SparklineSkeleton />
          ) : (
            // The read lands a beat after the card has risen in, so the body
            // fades up instead of cutting in over the skeleton in one frame.
            // The animation runs because this replaces SparklineSkeleton — a
            // different element type, so React mounts a fresh node rather than
            // reusing one that would keep its finished animation. `relative`
            // keeps the chart's absolutely-positioned line and dots on the same
            // box the frame's canvas defines.
            <div className="fade-in relative h-full w-full">
              {history.status === "error" ? (
                <SparklineNotice testId="sparkline-error">
                  Couldn&apos;t load your recent accuracy.
                </SparklineNotice>
              ) : trend ? (
                <AccuracySparkline data={trend} />
              ) : (
                <SparklineNotice testId="sparkline-empty">
                  Study this deck on another day to chart your accuracy trend.
                </SparklineNotice>
              )}
            </div>
          )}
        </SparklineFrame>
      </div>

      <div className="text-left">
        <GradeDistribution counts={counts} total={total} />
      </div>
    </div>
  );
}
