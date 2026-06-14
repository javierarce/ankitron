import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { ankiFetch } from "@/lib/anki-fetch";
import { deckLeaf } from "@/lib/deck";
import type { Note, DueCounts } from "@/lib/types";

export function DeckDetailPage() {
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = decodeURIComponent(rawName!);

  const [notes, setNotes] = useState<Note[]>([]);
  const [suspendedCardIds, setSuspendedCardIds] = useState<number[]>([]);
  const [due, setDue] = useState<DueCounts>({ new: 0, learn: 0, review: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        const noteIds = await ankiFetch<number[]>("findNotes", {
          query: `deck:"${deckName}"`,
        });
        const fetchedNotes =
          noteIds.length === 0
            ? []
            : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });
        if (cancelled) return;
        setNotes(fetchedNotes);

        const allCardIds = fetchedNotes.flatMap((n) => n.cards ?? []);
        if (allCardIds.length > 0) {
          const results = await ankiFetch<(boolean | null)[]>("areSuspended", {
            cards: allCardIds,
          });
          if (cancelled) return;
          setSuspendedCardIds(allCardIds.filter((_, i) => results[i]));
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
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm font-medium hover:bg-foreground/5 transition-colors"
          >
            Settings
          </Link>
          {totalDue > 0 ? (
            <Link
              to={`/decks/${encodeURIComponent(deckName)}/study`}
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
      </div>

      {error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <CardList
          deckName={deckName}
          notes={notes}
          suspendedCardIds={suspendedCardIds}
          onSuspendChange={refreshDue}
        />
      )}
    </div>
  );
}
