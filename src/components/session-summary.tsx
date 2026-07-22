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
   * This deck's recent per-day accuracy, for the trend sparkline. Fetched after
   * the session ends, so it's null while loading (the section just fades in when
   * it lands) and may be too short to plot — both cases hide the sparkline.
   */
  history?: readonly DailyAccuracy[] | null;
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
          card's order (history chart over the distribution). Only shown once
          enough history has landed to read as a trend. */}
      {history && history.length >= MIN_TREND_DAYS && (
        <div className="text-left">
          <AccuracySparkline data={history} />
        </div>
      )}

      <div className="text-left">
        <GradeDistribution counts={counts} total={total} />
      </div>
    </div>
  );
}
