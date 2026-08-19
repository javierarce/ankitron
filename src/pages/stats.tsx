// The Stats section: habit, memory, and what's coming.
//
// All of it folds out of a single cached revlog read (see lib/stats), so
// switching decks is a client-side filter — only the forecast goes back to
// Anki, as one batched request.
//
// Charts here are magnitude, so they use one sequential hue (the app's chart
// accent) light→dark rather than a spread of unrelated colours; the faint end
// of that ramp is deliberately low-contrast, with the hover tooltip and the
// legend as its relief.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CenteredSpinner, Spinner } from "@/components/spinner";
import { Tooltip } from "@/components/tooltip";
import { AnkiConnectionError } from "@/components/anki-connection-error";
import { DeckFilter } from "@/components/deck-filter";
import { useDeckNames } from "@/hooks/use-deck-names";
import { formatDeckPath } from "@/lib/deck";
import { useSync } from "@/lib/sync-context";
import { ChartDot } from "@/components/chart-dot";
import {
  fetchCollectionStats,
  type CollectionStats,
  type RetentionPoint,
} from "@/lib/stats";
import { addDays, type DayActivity } from "@/lib/stats/activity";

export function StatsPage() {
  // The deck filter lives in the URL (?deck=…) so a deck can link straight to
  // its own stats — from the decks list menu or the deck page — and so the
  // scope survives a reload. Replacing rather than pushing keeps in-page filter
  // changes out of the back stack: back returns to wherever you came from.
  const [params, setParams] = useSearchParams();
  const deckName = params.get("deck") ?? "";
  const setDeckName = (deck: string) =>
    setParams(deck ? { deck } : {}, { replace: true });
  // What's currently on screen, and which deck it describes. Keeping them
  // together means "the selection has moved ahead of the data" is derived
  // rather than a third state to keep in sync.
  const [rendered, setRendered] = useState<{
    deckName: string;
    stats: CollectionStats;
  } | null>(null);
  const [hasError, setHasError] = useState(false);
  const decks = useDeckNames();
  const { syncedAt, refreshedAt, registerPageLoad } = useSync();

  const loading = rendered === null && !hasError;
  const pending = rendered !== null && rendered.deckName !== deckName;

  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);

  // Re-runs when the deck filter changes and, silently, on any refresh. The
  // cache key stays syncedAt, so a *successful sync* remains the one thing that
  // forces a fresh read of the collection's history: a refresh that couldn't
  // reach AnkiWeb re-reads today's figures off the cached revlog instead of
  // paying for a history it knows hasn't changed.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stats = await fetchCollectionStats({
          deckName: deckName || undefined,
          cacheKey: syncedAt,
        });
        if (cancelled) return;
        setRendered({ deckName, stats });
        setHasError(false);
      } catch {
        if (!cancelled) setHasError(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncedAt is read as the cache key, but refreshedAt is what decides when to re-read; it bumps on every successful sync too, so no staleness slips through
  }, [deckName, refreshedAt]);

  if (hasError) return <AnkiConnectionError reason="unreachable" />;
  // Checked directly rather than via `loading` so TypeScript narrows it.
  if (rendered === null) return <CenteredSpinner />;

  const stats = rendered.stats;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-medium">Stats</h1>
          {/* The previous deck's figures stay on screen while the new ones
              load, so without this the page would look frozen. */}
          {pending && <Spinner size="sm" />}
        </div>
        <DeckFilter
          decks={decks}
          value={deckName}
          onChange={setDeckName}
          label="Filter stats by deck"
        />
      </div>

      {stats.partial && (
        <p className="text-sm text-muted-foreground">
          Some decks couldn&apos;t be read, so these figures are incomplete.
        </p>
      )}

      <div
        aria-busy={pending}
        className={`flex flex-col gap-8 transition-opacity duration-150 ${
          pending ? "opacity-50" : "opacity-100"
        }`}
      >
        {stats.totals.reviews === 0 ? (
          <p className="text-sm text-muted-foreground">
            No review history here yet. Study some cards and this fills in.
          </p>
        ) : (
          <>
            <HeroTiles stats={stats} deckName={rendered.deckName} />
            <Activity stats={stats} />
            <RetentionBlock stats={stats} />
            <TroubleSpots stats={stats} />
            <Forecast stats={stats} />
          </>
        )}
      </div>
    </div>
  );
}

// --- Blocks -----------------------------------------------------------------

function HeroTiles({
  stats,
  deckName,
}: {
  stats: CollectionStats;
  deckName: string;
}) {
  const { streak, totals, retention } = stats;
  // The streak number counts yesterday's day too (see computeStreaks), so on
  // its own it can't tell "safe" from "study today or lose it" — which is
  // exactly the moment the tile matters. So today's state drives both the
  // sub-line and the colour: the accent means "today is banked" and nothing
  // else, which is what makes a grey number readable at a glance instead of
  // needing the words underneath it. One condition, not a scale of urgency —
  // grey is unlit, not a warning.
  const longest = `longest ${streak.longest}`;
  // Scoped like everything else on this tile: under a deck filter, a day spent
  // on other decks isn't a day studied here, and an unqualified "Not studied
  // today" would read as a collection-wide claim that's simply false.
  const today = deckName ? "here today" : "today";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* A deck-scoped streak counts days you studied THAT deck, so it must say
          so — a bare "Streak" would look like the number had regressed. */}
      <Stat
        label={deckName ? `${formatDeckPath(deckName)} streak` : "Current streak"}
        value={`${streak.current}`}
        sub={`${streak.studiedToday ? "Studied" : "Not studied"} ${today} · ${longest}`}
        tone={streak.studiedToday ? "accent" : "muted"}
        // Collection-wide "Current streak" is self-evident; the deck-scoped
        // number needs the qualifier or it looks like the streak regressed.
        hint={
          deckName
            ? "Days in a row you studied this deck. Days spent only on other decks don't count here."
            : undefined
        }
      />
      <Stat
        label="Reviews"
        value={totals.reviews.toLocaleString()}
        sub={`${streak.activeDays} days studied`}
      />
      <Stat
        label="Time"
        value={hoursLabel(totals.seconds)}
        sub={`${totals.cardsSeen.toLocaleString()} cards`}
      />
      <Stat
        label="Retention"
        value={percent(retention.overall.rate)}
        sub="scheduled reviews, past year"
        hint="Correct answers on scheduled reviews — learning steps don't count. Around 90% is the sweet spot."
      />
    </div>
  );
}

function Activity({ stats }: { stats: CollectionStats }) {
  // The day the figures describe, not the render-time clock — same reason the
  // forecast axis uses it: a page still on screen after midnight would
  // otherwise mark the wrong cell as today.
  const todayMs = stats.forecastAnchorMs;
  const recent = stats.recentDays;
  const last = recent.length - 1;
  // Weekly ticks, so each label sits on the same weekday as today — with the
  // final one named rather than dated, since "did I study today" is the
  // question this chart is most often opened to answer.
  const weeklyTicks = everyNth(recent.length, 7, (i) => shortDate(recent[i].dayMs));
  return (
    <section className="flex flex-col gap-4">
      <Heading>Activity</Heading>
      <Heatmap days={stats.heatmapDays} todayMs={todayMs} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          Reviews per day · last 30 days
        </span>
        <Bars
          values={recent.map((d) => d.reviews)}
          tipFor={(i) => dayTip(recent[i], todayMs)}
          labelFor={(i) =>
            recent[i].dayMs === todayMs && i === last ? "Today" : weeklyTicks(i)
          }
        />
      </div>
    </section>
  );
}

function RetentionBlock({ stats }: { stats: CollectionStats }) {
  const { young, mature } = stats.retention;
  return (
    <section className="flex flex-col gap-4">
      {/* Not just "Retention" — the hero tile already carries that label, and
          two identical headings read as a repeat rather than a breakdown. */}
      <Heading>Retention by card age</Heading>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Young"
          value={percent(young.rate)}
          sub={`${young.reviews.toLocaleString()} reviews under 21 days`}
          hint="Cards seen again within three weeks. Some misses here are normal."
        />
        <Stat
          label="Mature"
          value={percent(mature.rate)}
          sub={`${mature.reviews.toLocaleString()} reviews at 21 days or more`}
          hint="Cards that waited three weeks or more — the truer test of long-term memory. Aim for around 90%."
        />
      </div>
      {stats.retentionTrend.length > 1 && (
        <div className="flex flex-col gap-1.5">
          {/* The scale is stated because a fixed 0–100% axis with no gridline
              otherwise reads as "nearly full" at 88%. */}
          <span className="text-xs text-muted-foreground">By month (0–100%)</span>
          <RetentionTrend points={stats.retentionTrend} />
        </div>
      )}
    </section>
  );
}

/**
 * The fix-list: notes that keep failing, each linking into its deck. Every
 * other block describes; this one points at work. An empty list renders as a
 * (deserved) all-clear rather than vanishing, so the block's absence never
 * reads as "nothing was checked".
 */
function TroubleSpots({ stats }: { stats: CollectionStats }) {
  const { hardest } = stats;
  return (
    <section className="flex flex-col gap-4">
      <Heading>Trouble spots</Heading>
      {hardest === null ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t read these cards&apos; details.
        </p>
      ) : hardest.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is repeatedly tripping you up — no card failed more than once
          this year.
        </p>
      ) : (
        // Cards in a responsive grid, matching the Stat tiles above — the
        // fronts are short phrases, so a full-width list left most of each
        // row empty and read as a table missing its columns.
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {hardest.map((note) => (
            <li key={note.noteId}>
              {/* Straight to the note's editor, not just to its deck: this
                  block is a fix-list, and the fix is an edit. The deck page
                  loads behind the editor, so closing it leaves you somewhere
                  you can keep working. */}
              <Link
                to={`/decks/${encodeURIComponent(note.deckName)}?note=${note.noteId}`}
                className="flex h-full flex-col gap-1.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-foreground/5"
              >
                {/* Wraps to two lines rather than truncating: the front IS
                    the content here, and a grid cell is narrow enough that
                    one-line truncation would cut most prompts mid-sentence. */}
                <span className="line-clamp-2 text-sm">
                  {note.front || "(empty front)"}
                </span>
                <span className="mt-auto flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{formatDeckPath(note.deckName)}</span>
                  <span className="shrink-0 tabular-nums">
                    {plural(note.lapses, "lapse")} ·{" "}
                    {Math.round(note.seconds / 60)} min
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Forecast({ stats }: { stats: CollectionStats }) {
  const { forecast } = stats;
  if (forecast === null) {
    return (
      <section className="flex flex-col gap-4">
        <Heading>Coming up</Heading>
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t read the upcoming schedule.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <Heading>Coming up</Heading>
      <Bars
        values={forecast.map((f) => f.due)}
        // Ticks anchored on day 0 rather than the far end, since "when does
        // this start" is the question a forecast answers. Dates derive from
        // the data's own anchor, never the render-time clock — with a cached
        // forecast viewed after midnight, the clock would put every bar under
        // the following day's label.
        labelFor={(i) =>
          i % 7 === 0
            ? i === 0
              ? "Today"
              : shortDate(addDays(stats.forecastAnchorMs, i))
            : ""
        }
        tipFor={(i) => {
          const f = forecast[i];
          const when = i === 0 ? "Today" : `In ${plural(i, "day")}`;
          const mins = f.minutes === null ? "" : ` · ~${Math.round(f.minutes)} min`;
          return `${when} · ${plural(f.due, "card")} due${mins}`;
        }}
      />
      <p className="text-sm text-muted-foreground">
        {plural(forecast[0].due, "card")} due today
        {forecast[0].minutes !== null && (
          <>
            {" · "}
            <Tooltip
              content="Estimated from your typical answer time over the last 30 days."
              side="top-end"
              wide
            >
              <span className="cursor-help border-b border-dotted border-foreground/40">
                {minutesLabel(forecast[0].minutes)}
              </span>
            </Tooltip>
          </>
        )}
      </p>
    </section>
  );
}

// --- Charts -----------------------------------------------------------------

// A sequential ramp in the app's chart accent, light→dark. Dark mode gets its
// own steps running dark→light against the dark surface rather than an
// automatic flip, which would leave the busiest days nearly invisible.
// Literal classes so Tailwind can see them.
const HEAT_STEPS = [
  "bg-foreground/[0.06] dark:bg-foreground/[0.08]",
  "bg-[#dbeafe] dark:bg-[#172554]",
  "bg-[#93c5fd] dark:bg-[#1e40af]",
  "bg-[#3b82f6] dark:bg-[#3b82f6]",
  "bg-[#1d4ed8] dark:bg-[#93c5fd]",
];

const BAR_FILL = "bg-[#3b82f6] dark:bg-[#60a5fa]";

/**
 * A year of study, one column per week. Reviews land in four intensity steps
 * rather than a continuous ramp so a single heavy day can't wash every ordinary
 * one out to the same faint tint.
 */
function Heatmap({ days, todayMs }: { days: DayActivity[]; todayMs: number }) {
  const max = Math.max(...days.map((d) => d.reviews), 1);
  const total = days.reduce((sum, d) => sum + d.reviews, 0);

  // Pad the first column so weekdays line up in rows, then chunk into weeks.
  const lead = (new Date(days[0].dayMs).getDay() + 6) % 7;
  const cells: (DayActivity | null)[] = [
    ...Array<null>(lead).fill(null),
    ...days,
  ];
  const weeks: (DayActivity | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="flex flex-col gap-1.5">
      <HoverLayer className="flex flex-col gap-1">
        {/* A month label on the week that contains the 1st, so the year reads
            as a timeline instead of an undifferentiated block. */}
        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <div
              key={i}
              className="min-w-0 flex-1 text-[10px] leading-none text-muted-foreground"
            >
              {monthStartLabel(week)}
            </div>
          ))}
        </div>
        <div
          role="img"
          aria-label={`${total.toLocaleString()} reviews over the past year`}
          className="flex gap-[3px]"
        >
          {weeks.map((week, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {week.map((d, j) =>
                d === null ? (
                  <div key={j} className="aspect-square" />
                ) : (
                  <div
                    key={d.dayMs}
                    data-tip={dayTip(d, todayMs)}
                    // Today is ringed so the eye can find it: an unstudied
                    // today is the faintest step there is, indistinguishable
                    // from the empty padding at the end of the last column.
                    className={`aspect-square rounded-[2px] ${HEAT_STEPS[heatLevel(d.reviews, max)]} ${
                      d.dayMs === todayMs
                        ? "ring-1 ring-inset ring-foreground/40"
                        : ""
                    }`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </HoverLayer>
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        {HEAT_STEPS.map((step) => (
          <span key={step} className={`h-2.5 w-2.5 rounded-[2px] ${step}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function heatLevel(reviews: number, max: number): number {
  if (reviews === 0) return 0;
  return Math.min(4, 1 + Math.floor((reviews / max) * 3.99));
}

/**
 * Monthly retention as a line with dots — deliberately NOT the Bars component.
 * This chart plots a rate while its neighbours plot volume; drawn as the same
 * blue bars it read as "how much you studied", and a reader had no cue that
 * the y-axis had changed meaning. A line over a fixed 0–100% scale is the
 * house shape for "a rate over time" (AccuracySparkline), whose geometry and
 * colours this follows: stretched SVG for the line and area (thin strokes
 * distort invisibly), HTML ChartDots overlaid at the same coordinates so they
 * stay round and hoverable, newest point accented.
 */
function RetentionTrend({ points }: { points: RetentionPoint[] }) {
  const padTop = 12;
  const padBottom = 8;
  const n = points.length;
  const baseY = 100 - padBottom; // the 0% line

  // Full-bleed horizontally: the first and last points sit ON the edges, so
  // the chart spans exactly the same width as the bars and heatmap above it —
  // inset padding here made it read as off-centre next to them. The edge dots
  // overhang the container by half their width; that's fine because nothing
  // here is overflow-hidden, and ChartDot already flips its tooltip inward
  // near the edges.
  const pos = (p: RetentionPoint, i: number) => ({
    x: (n <= 1 ? 0.5 : i / (n - 1)) * 100,
    y: padTop + (1 - (p.overall.rate ?? 0)) * (100 - padTop - padBottom),
  });

  const linePts = points.map((p, i) => {
    const { x, y } = pos(p, i);
    return `${x},${y}`;
  });
  const areaPts = `${pos(points[0], 0).x},${baseY} ${linePts.join(" ")} ${
    pos(points[n - 1], n - 1).x
  },${baseY}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-24">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Retention by month over ${plural(n, "month")}`}
        >
          <line
            x1={0}
            y1={baseY}
            x2={100}
            y2={baseY}
            stroke="currentColor"
            strokeWidth={1}
            className="text-foreground/10"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={areaPts}
            fill="currentColor"
            className="text-foreground/[0.07]"
          />
          <polyline
            points={linePts.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-foreground/25"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {points.map((p, i) => {
          const { x, y } = pos(p, i);
          return (
            <ChartDot
              key={p.startMs}
              x={x}
              y={y}
              size={i === n - 1 ? "lg" : "sm"}
              color={i === n - 1 ? "#3b82f6" : "#a1a1aa"}
              content={`${monthLabel(p.startMs)} · ${percent(p.overall.rate)} of ${plural(
                p.overall.reviews,
                "review",
              )}`}
            />
          );
        })}
      </div>
      {/* Month ticks aligned to the dots' x positions, not a flex grid — the
          points are evenly spaced in SVG coordinates, so the labels must use
          the same coordinate space to sit under their dots. */}
      <div aria-hidden className="relative h-4">
        {points.map((p, i) => {
          const { x } = pos(p, i);
          return (
            <span
              key={p.startMs}
              className={`absolute top-0 whitespace-nowrap text-[10px] leading-none text-muted-foreground ${
                i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"
              }`}
              style={{ left: `${x}%` }}
            >
              {shortMonth(p.startMs)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Bars({
  values,
  tipFor,
  labelFor,
  max,
  height = 96,
}: {
  values: number[];
  tipFor: (index: number) => string;
  /**
   * Axis label for a bar, or "" for none. Deliberately selective — a label on
   * every one of 30 bars is unreadable, so callers tick every nth.
   */
  labelFor?: (index: number) => string;
  /** Fixed scale; omit to autoscale to the tallest bar. */
  max?: number;
  height?: number;
}) {
  const top = max ?? Math.max(...values, 1);
  const last = values.length - 1;
  return (
    <div className="flex flex-col gap-1">
      <HoverLayer className="flex items-end gap-[2px]" style={{ height }}>
        {values.map((v, i) => (
          <div
            key={i}
            data-tip={tipFor(i)}
            // The full-height wrapper is the hover target, so a short bar is as
            // easy to hit as a tall one.
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <div
              className={`w-full rounded-t-[3px] ${v > 0 ? BAR_FILL : "bg-foreground/[0.08]"}`}
              // A floor keeps an empty day visible as an empty day rather than
              // as a missing bar.
              style={{ height: `${Math.max(2, (v / top) * height)}px` }}
            />
          </div>
        ))}
      </HoverLayer>
      {labelFor && (
        <div aria-hidden className="flex gap-[2px]">
          {values.map((_, i) => (
            // Each cell tracks its bar's width so a label stays centred on it.
            // A label is far wider than a bar, so it overflows into the empty
            // cells either side — which is why only every nth bar gets one.
            // The outermost labels align to their edge instead, so they can't
            // spill outside the chart.
            <div key={i} className="min-w-0 flex-1">
              <span
                className={`block whitespace-nowrap text-[10px] leading-none text-muted-foreground ${
                  i === 0 ? "text-left" : i === last ? "text-right" : "text-center"
                }`}
              >
                {labelFor(i)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Label every `step`th bar, anchored so the newest/last one is always labelled
 * — that's the bar the eye lands on, and an axis whose final tick floats
 * mid-chart reads as though the data stops early.
 */
function everyNth(
  count: number,
  step: number,
  render: (index: number) => string,
): (index: number) => string {
  return (i) => ((count - 1 - i) % step === 0 ? render(i) : "");
}

/**
 * One floating tooltip per chart, driven by a single listener that reads
 * `data-tip` off whatever is under the pointer.
 *
 * Not the native `title` attribute (the browser's own delay makes it feel
 * broken) and not a Tooltip component per mark — a year heatmap is 365 cells,
 * and 365 stateful components re-rendering on hover is its own kind of slow.
 */
function HoverLayer({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const host = useRef<HTMLDivElement>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );

  function onMove(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (target === hovered.current) return; // same mark — nothing to recompute
    hovered.current = target;
    if (!target || !host.current) return setTip(null);
    const hostBox = host.current.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    setTip({
      text: target.dataset.tip ?? "",
      x: box.left - hostBox.left + box.width / 2,
      y: box.top - hostBox.top,
    });
  }

  function onLeave() {
    hovered.current = null;
    setTip(null);
  }

  return (
    <div
      ref={host}
      className={`relative ${className ?? ""}`}
      style={style}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground/80 shadow-md"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </span>
      )}
    </div>
  );
}

// --- Bits -------------------------------------------------------------------

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-medium">{children}</h2>;
}

function Stat({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  /**
   * A plain-language explanation of a jargon label, shown on hover — the same
   * dotted-underline idiom as the note-stats panel's Fact. Reserved for terms
   * that genuinely need it; a page of dotted underlines reads as homework.
   */
  hint?: string;
  /**
   * Colour the headline number — for the one tile that leads the page.
   *
   * The two tones are lit and unlit, not good and bad: "muted" replaces the
   * accent rather than adding a second colour beside it, so a streak that
   * hasn't been kept today simply isn't lit up yet. A warning colour here was
   * both louder than the situation deserves and, next to the accent, two
   * competing signals in one small tile.
   *
   * Only meaningful because the caller uses it for exactly one condition — a
   * tone that sometimes means "unlit" and sometimes "less important" would
   * mean nothing at all.
   */
  tone?: "accent" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">
        {hint ? (
          <Tooltip content={hint} side="top-start" wide>
            <span className="cursor-help border-b border-dotted border-foreground/40">
              {label}
            </span>
          </Tooltip>
        ) : (
          label
        )}
      </div>
      <div
        className={`text-xl font-semibold tabular-nums ${
          tone === "accent"
            ? "text-[#2563eb] dark:text-[#60a5fa]"
            : tone === "muted"
              ? "text-muted-foreground"
              : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** A rate as a whole percentage; an empty bucket reads as unknown, not 0%. */
function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A duration for the Time tile. Falls back to minutes under an hour —
 * rounding straight to hours showed "0 h" over a non-zero card count
 * whenever the deck filter scoped to a small deck.
 */
function hoursLabel(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600).toLocaleString()} h`;
}

/**
 * "about 5 minutes" / "about 1 minute" / "less than a minute". Rounding
 * happens BEFORE choosing the noun — pluralising the raw value printed
 * "about 1 minutes" whenever the estimate rounded to one.
 */
function minutesLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 1) return "less than a minute";
  return `about ${plural(rounded, "minute")}`;
}

/**
 * A day's tooltip in the heatmap and the 30-day bars. Today is named rather
 * than dated: reading a date off the last mark and matching it against your own
 * sense of the date is exactly the work this page shouldn't ask for.
 */
function dayTip(day: DayActivity, todayMs: number): string {
  const when = day.dayMs === todayMs ? "Today" : dateLabel(day.dayMs);
  return `${when} · ${plural(day.reviews, "review")}`;
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "15 Jun" — compact enough to tick a 30-bar axis without collisions. */
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Jun". A rolling year holds each month once, so no year is needed. */
function shortMonth(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short" });
}

function monthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/**
 * The month name, on the single week that contains the 1st.
 *
 * Matches the 1st exactly, not "day <= 7": days 1–7 straddle two Monday-aligned
 * columns whenever a month doesn't start on a Monday, so the looser test
 * labelled both and the header read "Aug Aug Sep Oct Oct Nov Nov".
 */
function monthStartLabel(week: (DayActivity | null)[]): string {
  const first = week.find((d) => d !== null && new Date(d.dayMs).getDate() === 1);
  return first
    ? new Date(first.dayMs).toLocaleDateString(undefined, { month: "short" })
    : "";
}
