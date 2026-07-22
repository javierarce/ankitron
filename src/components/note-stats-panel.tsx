import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spinner } from "./spinner";
import { Tooltip } from "./tooltip";
import { GradeDistribution } from "./grade-distribution";
import { ChartDot } from "./chart-dot";
import { fetchNoteStats } from "@/lib/note-stats";
import { GRADES, gradeColor } from "@/lib/grades";
import type { CardReview, CardState, Note, NoteStats } from "@/lib/types";

const DAY_MS = 86_400_000;

const STATE_LABEL: Record<CardState, string> = {
  new: "New",
  learning: "Learning",
  review: "Review",
  relearning: "Relearning",
  suspended: "Suspended",
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "today" / "yesterday" / "12 days ago" — a soft companion to the exact date. */
function relativeDays(ms: number): string {
  const days = Math.round((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)} min`;
}

function formatInterval(days: number): string {
  if (days <= 0) return "—";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** A review's readout, e.g. "Good · 15d · Mar 3, 2025". */
function reviewLabel(r: CardReview): string {
  const grade = GRADES.find((g) => g.ease === r.ease)?.label ?? "?";
  // A review's own interval is what it *scheduled*; sub-day steps come back as
  // seconds (≤0 here), so read those as "under a day" rather than "—".
  const ivl = r.ivl > 0 ? formatInterval(r.ivl) : "<1d";
  return `${grade} · ${ivl} · ${formatDate(r.id)}`;
}

interface NoteStatsPanelProps {
  note: Note;
  /**
   * Seeds the container height on (re)mount. The panel is remounted per note
   * while paging a selection, so paging would otherwise collapse to the
   * spinner's height before the next note's stats land; seeding with the
   * previous note's height keeps the dialog steady and lets it animate.
   */
  initialHeight?: number;
  /** Reports the measured content height so the caller can seed the next mount. */
  onHeightChange?: (height: number) => void;
}

export function NoteStatsPanel({
  note,
  initialHeight,
  onHeightChange,
}: NoteStatsPanelProps) {
  const [stats, setStats] = useState<NoteStats | null>(null);
  const [error, setError] = useState(false);
  const [height, setHeight] = useState<number | undefined>(initialHeight);

  // Clip overflow only while the height is animating (so content doesn't spill
  // on shrink); at rest let it show, so a Fact tooltip isn't clipped.
  const [animating, setAnimating] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  // Read inside the ResizeObserver, which fires before React state has painted.
  const statsRef = useRef<NoteStats | null>(null);
  const heightRef = useRef<number | undefined>(initialHeight);
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    let cancelled = false;
    fetchNoteStats(note)
      .then((s) => {
        if (cancelled) return;
        statsRef.current = s;
        setStats(s);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [note]);

  // Track the content's natural height and drive the container's animated
  // height to it — but only once the real stats are in, so the loading
  // placeholder never becomes the thing we animate to.
  useLayoutEffect(() => {
    const el = contentRef.current;
    // ResizeObserver is absent under jsdom; the height just won't animate there.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!statsRef.current) return;
      const h = el.offsetHeight;
      onHeightChangeRef.current?.(h);
      // A real change (not the first measure) triggers the height transition;
      // clip until it settles (onTransitionEnd below).
      if (heightRef.current !== undefined && heightRef.current !== h) {
        setAnimating(true);
      }
      heightRef.current = h;
      setHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const body =
    error && !stats ? (
      <p className="py-8 text-center text-sm text-foreground/50">
        Couldn&apos;t load this note&apos;s statistics.
      </p>
    ) : !stats ? (
      // Hold the previous note's height while loading so the modal doesn't jump.
      <div
        className="flex items-center justify-center py-12"
        style={initialHeight ? { minHeight: initialHeight } : undefined}
      >
        <Spinner size="md" />
      </div>
    ) : (
      <StatsBody stats={stats} />
    );

  return (
    <div
      className={animating ? "overflow-hidden" : ""}
      style={{ height, transition: "height 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "height") setAnimating(false);
      }}
    >
      <div ref={contentRef}>{body}</div>
    </div>
  );
}

function StatsBody({ stats }: { stats: NoteStats }) {
  const studied = stats.totalReviews > 0;
  const allReviews = stats.cards
    .flatMap((c) => c.reviews)
    .sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-5">
      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Success"
          value={
            stats.successRate == null
              ? "—"
              : `${Math.round(stats.successRate * 100)}%`
          }
        />
        <Stat label="Reviews" value={String(stats.totalReviews)} />
        <Stat label="Lapses" value={String(stats.totalLapses)} />
        <Stat label="Interval" value={formatInterval(stats.intervalDays)} />
      </div>

      {!studied ? (
        <p className="rounded-lg border border-border bg-foreground/[0.02] px-4 py-6 text-center text-sm text-foreground/60">
          This note hasn&apos;t been studied yet.
        </p>
      ) : (
        <>
          {/* Evolution: interval growth with each review coloured by grade.
              Hovering a dot surfaces that review's details in a tooltip. */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-foreground/40">
                History
              </h4>
              <span className="truncate text-xs tabular-nums text-foreground/50">
                {allReviews.length} reviews
              </span>
            </div>
            <IntervalChart reviews={allReviews} />
          </section>

          {/* Answer-button distribution. */}
          <GradeDistribution counts={stats.gradeCounts} total={stats.totalReviews} />
        </>
      )}

      {/* Facts row */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Fact
          term="Added"
          value={stats.createdAt ? formatDate(stats.createdAt) : "—"}
        />
        <Fact
          term="First studied"
          value={
            stats.firstReviewedAt ? relativeDays(stats.firstReviewedAt) : "—"
          }
          valueHint={
            stats.firstReviewedAt ? formatDate(stats.firstReviewedAt) : undefined
          }
        />
        <Fact
          term="Last studied"
          value={stats.lastReviewedAt ? relativeDays(stats.lastReviewedAt) : "—"}
        />
        <Fact
          term="Time spent"
          value={studied ? formatDuration(stats.totalTimeMs) : "—"}
        />
        <Fact
          term="Ease"
          value={stats.easePercent ? `${stats.easePercent}%` : "—"}
          hint="How fast the interval grows on Good. 250% = ×2.5 each time; lower means a harder card."
        />
        <Fact
          term={stats.cards.length === 1 ? "State" : "Cards"}
          value={
            stats.cards.length === 1
              ? STATE_LABEL[stats.cards[0].state]
              : `${stats.cards.length} cards`
          }
          hint={
            stats.cards.length === 1
              ? "The card's scheduling stage — New, Learning, Review (graduated to day-plus gaps), Relearning (lapsed), or Suspended."
              : undefined
          }
        />
      </dl>

      {stats.isLeech && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-500">
          ⚠ Anki has flagged this note as a leech — you forget it more often than
          most.
        </p>
      )}

      {/* Per-card breakdown, only when a note has more than one card. */}
      {stats.cards.length > 1 && (
        <section>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/40">
            Per card
          </h4>
          <div className="space-y-1.5">
            {stats.cards.map((c, i) => (
              <div
                key={c.cardId}
                className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
              >
                <span className="text-foreground/70">Card {i + 1}</span>
                <span className="flex items-center gap-3 tabular-nums text-foreground/50">
                  <span>{STATE_LABEL[c.state]}</span>
                  <span>{c.reps} reviews</span>
                  <span>{c.lapses} lapses</span>
                  <span>{formatInterval(c.intervalDays)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="text-xs text-foreground/50">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Fact({
  term,
  value,
  hint,
  valueHint,
}: {
  term: string;
  value: string;
  /** An explanation shown on hover, for jargon terms like Ease. */
  hint?: string;
  /** Extra detail shown on hover over the value, e.g. an exact date. */
  valueHint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-foreground/50">
        {hint ? (
          // Opens up-and-right from the term, so the wide bubble stays inside
          // the dialog even for a bottom-left term like Ease.
          <Tooltip content={hint} side="top-start" wide>
            <span className="cursor-help border-b border-dotted border-foreground/40">
              {term}
            </span>
          </Tooltip>
        ) : (
          term
        )}
      </dt>
      <dd className="tabular-nums text-foreground/80">
        {valueHint ? (
          // The value is right-aligned, so open up-and-left to stay in the dialog.
          <Tooltip content={valueHint} side="top-end">
            <span className="cursor-help border-b border-dotted border-foreground/40">
              {value}
            </span>
          </Tooltip>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// A compact "evolution" chart: interval (y) over *real time* (x), so same-day
// reviews cluster and gaps reflect the actual days between them. The line is an
// SVG stretched to fill (distorting a thin stroke is invisible); the dots are
// HTML overlaid at the same coordinates so they stay round and hoverable. Reads
// left-to-right as the card's life: intervals climb, collapse on a lapse, then
// rebuild. Hovering a dot surfaces its details in a tooltip; the dates under the
// chart anchor the time axis.
function IntervalChart({ reviews }: { reviews: CardReview[] }) {
  const padX = 1.5; // just enough inset that edge dots aren't clipped
  const padY = 12;
  const maxIvl = Math.max(1, ...reviews.map((r) => Math.max(0, r.ivl)));

  const times = reviews.map((r) => r.id);
  const tMin = Math.min(...times);
  const tSpan = Math.max(...times) - tMin;

  // Position in 0–100 space, shared by the SVG line and the HTML dots. x is the
  // review's timestamp (falling back to even spacing if every review shares
  // one); y is its interval.
  const pos = (r: CardReview, i: number) => {
    const xFrac =
      reviews.length <= 1
        ? 0.5
        : tSpan > 0
          ? (r.id - tMin) / tSpan
          : i / (reviews.length - 1);
    return {
      x: padX + xFrac * (100 - padX * 2),
      y: padY + (1 - Math.max(0, r.ivl) / maxIvl) * (100 - padY * 2),
    };
  };

  const linePts = reviews.map((r, i) => {
    const p = pos(r, i);
    return `${p.x},${p.y}`;
  });
  const baseY = 100 - padY; // the interval-zero line
  const summary = `Interval grew to ${formatInterval(maxIvl)} over ${reviews.length} reviews.`;

  return (
    <>
      <div className="relative h-32 w-full">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        role="img"
        aria-label={summary}
      >
        <line
          x1={padX}
          y1={baseY}
          x2={100 - padX}
          y2={baseY}
          stroke="currentColor"
          strokeWidth={1}
          className="text-foreground/10"
          vectorEffect="non-scaling-stroke"
        />
        {reviews.length > 1 && (
          <polyline
            points={linePts.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-foreground/25"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {reviews.map((r, i) => {
        const p = pos(r, i);
        return (
          <ChartDot
            key={r.id}
            x={p.x}
            y={p.y}
            color={gradeColor(r.ease)}
            content={reviewLabel(r)}
          />
        );
      })}
      </div>
      {reviews.length > 1 && (
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-foreground/35">
          <span>{formatDate(reviews[0].id)}</span>
          <span>{formatDate(reviews[reviews.length - 1].id)}</span>
        </div>
      )}
    </>
  );
}
