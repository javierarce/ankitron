import type { StudyStats } from "@/lib/types";

/** Mirror Anki's wording: "Studied 53 cards in 6.27 minutes today (7.1s/card)". */
function formatToday({ cards, seconds }: StudyStats): string {
  const time =
    seconds < 60
      ? `${Math.round(seconds)} seconds`
      : `${(seconds / 60).toFixed(2)} minutes`;
  const perCard = (seconds / cards).toFixed(1);
  const noun = cards === 1 ? "card" : "cards";
  return `Studied ${cards} ${noun} in ${time} today (${perCard}s/card)`;
}

export function StudySummary({ stats }: { stats: StudyStats | null }) {
  if (!stats) return null;

  return (
    <footer className="pt-4 text-center text-sm text-foreground/50 tabular-nums">
      {stats.cards === 0 ? "No cards studied yet today." : formatToday(stats)}
    </footer>
  );
}
