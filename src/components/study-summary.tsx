import type { StudyStats } from "@/lib/types";

/** e.g. "Studied 27 cards in 2.3 minutes today (5.1 seconds per card)". */
function formatToday({ cards, seconds }: StudyStats): string {
  const time =
    seconds < 60
      ? `${Math.round(seconds)} seconds`
      : `${(seconds / 60).toFixed(1)} minutes`;
  const perCard = (seconds / cards).toFixed(1);
  const noun = cards === 1 ? "card" : "cards";
  return `Studied ${cards} ${noun} in ${time} today (${perCard} seconds per card)`;
}

export function StudySummary({ stats }: { stats: StudyStats | null }) {
  // The summary is non-critical and lands a beat after the decks (one extra
  // request per deck). Always render the footer at its full height — even before
  // stats arrive — so the centered deck list above stays put instead of shifting
  // up when the line appears. The text itself fades in once it's ready.
  return (
    <footer className="pt-4 text-center text-sm text-foreground/50 tabular-nums">
      <span className="block min-h-[1.25rem]">
        {stats && (
          <span className="count-fade-in">
            {stats.cards === 0
              ? "No cards studied yet today."
              : formatToday(stats)}
          </span>
        )}
      </span>
    </footer>
  );
}
