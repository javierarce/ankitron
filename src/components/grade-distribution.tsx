import { GRADES } from "@/lib/grades";

interface GradeCounts {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

// The answer-button distribution: a stacked bar of Again/Hard/Good/Easy plus a
// legend that doubles as the colour key. Shared by the per-note stats panel and
// the end-of-session summary so both read in the same visual language. Grades
// with no answers are omitted rather than shown at 0%.
export function GradeDistribution({
  counts,
  total,
  heading = "Answers",
}: {
  counts: GradeCounts;
  total: number;
  heading?: string;
}) {
  const byGrade = [
    { ...GRADES[0], n: counts.again },
    { ...GRADES[1], n: counts.hard },
    { ...GRADES[2], n: counts.good },
    { ...GRADES[3], n: counts.easy },
  ];
  return (
    <section>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/40">
        {heading}
      </h4>
      <div className="flex h-3 overflow-hidden rounded-full bg-foreground/5">
        {byGrade.map(
          (g) =>
            g.n > 0 && (
              <div
                key={g.ease}
                style={{ width: `${(g.n / total) * 100}%`, backgroundColor: g.color }}
              />
            ),
        )}
      </div>
      {/* Legend doubles as the key for the chart's dot colours — each grade that
          actually occurred, with its count and share. Grades with no answers are
          omitted rather than shown at 0%. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {byGrade
          .filter((g) => g.n > 0)
          .map((g) => (
            <span key={g.ease} className="flex items-center gap-1.5 text-xs text-foreground/50">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: g.color }}
              />
              {g.label}
              <span className="tabular-nums text-foreground/70">
                {g.n}
                <span className="text-foreground/40">
                  {" "}
                  · {Math.round((g.n / total) * 100)}%
                </span>
              </span>
            </span>
          ))}
      </div>
    </section>
  );
}
