import { getNotesInDeck, getDueCount, ankiRequest } from "@/lib/anki-client";
import { CardList } from "@/components/card-list";
import { DangerZone } from "@/components/danger-zone";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface DeckPageProps {
  params: Promise<{ deckName: string }>;
}

export default async function DeckPage({ params }: DeckPageProps) {
  const { deckName: rawName } = await params;
  const deckName = decodeURIComponent(rawName);

  let notes;
  let error: string | null = null;
  let suspendedCardIds: number[] = [];

  try {
    notes = await getNotesInDeck(deckName);
    // Collect all card IDs from notes and check suspension status
    const allCardIds = notes.flatMap((n) => n.cards ?? []);
    if (allCardIds.length > 0) {
      const results = await ankiRequest<(boolean | null)[]>("areSuspended", { cards: allCardIds });
      suspendedCardIds = allCardIds.filter((_, i) => results[i]);
    }
  } catch {
    error = "Could not load cards. Make sure Anki is running.";
  }

  const due = await getDueCount(deckName);
  const totalDue = due.new + due.learn + due.review;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{deckName}</h1>
        {totalDue > 0 ? (
          <Link
            href={`/decks/${encodeURIComponent(deckName)}/study`}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm font-medium hover:bg-foreground/5 transition-colors"
          >
            Study ({totalDue})
          </Link>
        ) : (
          <span className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-medium text-foreground/30 cursor-not-allowed">
            No cards due
          </span>
        )}
      </div>

      {error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <CardList deckName={deckName} notes={notes!} suspendedCardIds={suspendedCardIds} />
      )}

      <DangerZone deckName={deckName} />
    </div>
  );
}
