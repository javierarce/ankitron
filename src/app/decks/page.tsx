import { getDecks, getDueCount } from "@/lib/anki-client";
import { AllDecksList } from "@/components/all-decks-list";
import type { DueCounts } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DecksPage() {
  let decks: string[] = [];
  let hasError = false;

  try {
    decks = await getDecks();
  } catch {
    hasError = true;
  }

  const dueCounts: Record<string, DueCounts> = {};
  if (decks.length > 0) {
    const results = await Promise.all(
      decks.map(async (deck) => ({ deck, due: await getDueCount(deck) }))
    );
    for (const { deck, due } of results) {
      dueCounts[deck] = due;
    }
  }

  if (hasError) {
    return (
      <p className="text-foreground/60">
        Could not load decks. Make sure Anki is running.
      </p>
    );
  }

  return <AllDecksList decks={decks} dueCounts={dueCounts} />;
}
