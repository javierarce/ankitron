import { getDecks, getDueCount } from "@/lib/anki-client";
import { DeckList } from "@/components/deck-list";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let decks: string[] = [];
  let error: string | null = null;

  try {
    decks = await getDecks();
  } catch {
    error = "Could not connect to AnkiConnect. Make sure Anki is running with AnkiConnect installed.";
  }

  const dueCounts: Record<string, number> = {};
  if (decks.length > 0) {
    const results = await Promise.all(
      decks.map(async (deck) => {
        const due = await getDueCount(deck);
        return { deck, total: due.new + due.learn + due.review };
      })
    );
    for (const { deck, total } of results) {
      dueCounts[deck] = total;
    }
  }

  return (
    <div>
      {error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <DeckList decks={decks} dueCounts={dueCounts} />
      )}
    </div>
  );
}
