import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { ankiFetch } from "@/lib/anki-fetch";
import { compareDeckPaths, deckLeaf } from "@/lib/deck";
import type { Note, DueCounts } from "@/lib/types";

export function DeckDetailPage() {
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = decodeURIComponent(rawName!);

  const [notes, setNotes] = useState<Note[]>([]);
  const [suspendedCardIds, setSuspendedCardIds] = useState<number[]>([]);
  // Each note's home deck (the deck of its first card), so the card list can
  // scope to a single subdeck. A note's cards normally share a deck; we key off
  // the first one.
  const [noteDecks, setNoteDecks] = useState<Record<number, string>>({});
  // Every deck nested under this one ("Spanish::Verbs", …), sorted as a tree.
  const [subdecks, setSubdecks] = useState<string[]>([]);
  const [due, setDue] = useState<DueCounts>({ new: 0, learn: 0, review: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const refreshDue = useCallback(async () => {
    try {
      const stats = await ankiFetch<
        Record<string, { name: string; new_count: number; learn_count: number; review_count: number }>
      >("getDeckStats", { decks: [deckName] });
      const deckStats = Object.values(stats)[0];
      if (deckStats) {
        setDue({
          new: deckStats.new_count ?? 0,
          learn: deckStats.learn_count ?? 0,
          review: deckStats.review_count ?? 0,
        });
      }
    } catch {
      // keep the previous counts
    }
  }, [deckName]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [noteIds, allDeckNames] = await Promise.all([
          ankiFetch<number[]>("findNotes", { query: `deck:"${deckName}"` }),
          ankiFetch<string[]>("deckNames"),
        ]);
        if (cancelled) return;
        setSubdecks(
          allDeckNames
            .filter((n) => n.startsWith(deckName + "::"))
            .sort(compareDeckPaths),
        );

        const fetchedNotes =
          noteIds.length === 0
            ? []
            : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });
        if (cancelled) return;
        setNotes(fetchedNotes);

        const allCardIds = fetchedNotes.flatMap((n) => n.cards ?? []);
        if (allCardIds.length > 0) {
          // One cardsInfo call gives us both each card's deck (to scope the list
          // to a subdeck) and its scheduling queue (-1 means suspended), so we
          // don't need a separate areSuspended round-trip.
          const cards = await ankiFetch<
            { cardId: number; deckName: string; queue: number }[]
          >("cardsInfo", { cards: allCardIds });
          if (cancelled) return;
          const byCard = new Map(cards.map((c) => [c.cardId, c]));
          setSuspendedCardIds(
            allCardIds.filter((id) => byCard.get(id)?.queue === -1),
          );
          const decksByNote: Record<number, string> = {};
          for (const note of fetchedNotes) {
            const firstCard = (note.cards ?? []).find((id) => byCard.has(id));
            const deck = firstCard != null ? byCard.get(firstCard)?.deckName : undefined;
            if (deck) decksByNote[note.noteId] = deck;
          }
          setNoteDecks(decksByNote);
        }

        if (cancelled) return;
        await refreshDue();
      } catch {
        if (!cancelled) setError("Could not load cards. Make sure Anki is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [deckName, refreshDue]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
      </div>
    );
  }

  const totalDue = due.new + due.learn + due.review;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{deckLeaf(deckName)}</h1>
        <div className="flex items-center gap-2">
          <Link
            to={`/decks/${encodeURIComponent(deckName)}/settings`}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5 transition-colors"
          >
            Settings
          </Link>
          <button
            onClick={() => setShowAddForm(true)}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5 transition-colors"
          >
            Add card
          </button>
          {totalDue > 0 ? (
            <Link
              to={`/decks/${encodeURIComponent(deckName)}/study`}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              Study ({totalDue})
            </Link>
          ) : (
            <span className="rounded-lg border border-foreground/10 px-4 py-2 text-sm text-foreground/30 cursor-not-allowed">
              No cards due
            </span>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <CardList
          deckName={deckName}
          notes={notes}
          suspendedCardIds={suspendedCardIds}
          noteDecks={noteDecks}
          subdecks={subdecks}
          onSuspendChange={refreshDue}
          onCardsMoved={refreshDue}
          showAddForm={showAddForm}
          onShowAddForm={setShowAddForm}
        />
      )}
    </div>
  );
}
