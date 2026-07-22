import type { DailyAccuracy } from "@/lib/session-history";
import { ChartDot } from "./chart-dot";

// The "today" point's accent — the same blue the grade charts use for Easy, so
// the just-finished day stands out from the muted history behind it. Past days
// use a solid neutral (not a translucent foreground, which lets the background
// show through the dot).
const TODAY_COLOR = "#3b82f6";
const PAST_COLOR = "#a1a1aa";

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * A compact accuracy-over-recent-days sparkline for the session summary. The
 * y-axis is a fixed 0–100% — never autoscaled — so a flat line high up honestly
 * reads as "consistently good" instead of stretching day-to-day noise into a
 * dramatic-looking swing. The area under the line is filled down to the 0%
 * baseline so a high line doesn't leave a big empty band beneath it; the fill
 * itself reads as "how much accuracy". The line is an SVG stretched to fill (a
 * thin stroke distorts invisibly); the dots are HTML overlaid at the same
 * coordinates so they stay round, with the most recent day accented as "today"
 * and each showing its day's numbers in a tooltip on hover.
 */
export function AccuracySparkline({ data }: { data: readonly DailyAccuracy[] }) {
  const padX = 2;
  const padTop = 12;
  const padBottom = 8;
  const n = data.length;
  const lastIdx = n - 1;
  const baseY = 100 - padBottom; // the 0% line

  // x by chronological position (even spacing — gaps between study days aren't
  // meaningful here); y by accuracy on the fixed 0–100% scale.
  const pos = (d: DailyAccuracy, i: number) => ({
    x: padX + (n <= 1 ? 0.5 : i / (n - 1)) * (100 - padX * 2),
    y: padTop + (1 - d.accuracy) * (100 - padTop - padBottom),
  });

  const linePts = data.map((d, i) => {
    const p = pos(d, i);
    return `${p.x},${p.y}`;
  });
  // The line closed down to the baseline, so the area beneath it can be filled.
  const areaPts =
    n > 1
      ? `${pos(data[0], 0).x},${baseY} ${linePts.join(" ")} ${pos(data[lastIdx], lastIdx).x},${baseY}`
      : "";

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-foreground/40">
          Recent accuracy
        </h4>
        <span className="text-xs tabular-nums text-foreground/50">
          last {n} days
        </span>
      </div>
      <div className="relative h-28 w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Accuracy over the last ${n} study days`}
        >
          {/* Faint 0% baseline, so the filled area reads against a floor. */}
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
          {n > 1 && (
            <>
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
            </>
          )}
        </svg>
        {data.map((d, i) => {
          const p = pos(d, i);
          const isToday = i === lastIdx;
          const pct = Math.round(d.accuracy * 100);
          return (
            <ChartDot
              key={d.dayMs}
              x={p.x}
              y={p.y}
              size={isToday ? "lg" : "sm"}
              color={isToday ? TODAY_COLOR : PAST_COLOR}
              content={`${pct}% · ${d.total} ${
                d.total === 1 ? "review" : "reviews"
              } · ${formatDay(d.dayMs)}`}
            />
          );
        })}
      </div>
    </section>
  );
}
