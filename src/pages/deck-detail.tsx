import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { DangerZone } from "@/components/danger-zone";
import { DeckSettings } from "@/components/deck-settings";
import { ImportExport } from "@/components/import-export";
import { ankiFetch } from "@/lib/anki-fetch";
import type { Note, DueCounts } from "@/lib/types";

export function DeckDetailPage() {
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = decodeURIComponent(rawName!);

  const [notes, setNotes] = useState<Note[]>([]);
  const [suspendedCardIds, setSuspendedCardIds] = useState<number[]>([]);
  const [due, setDue] = useState<DueCounts>({ new: 0, learn: 0, review: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

        const stats = await ankiFetch<
          Record<string, { name: string; new_count: number; learn_count: number; review_count: number }>
        >("getDeckStats", { decks: [deckName] });
        if (cancelled) return;
        const deckStats = Object.values(stats)[0];
        if (deckStats) {
          setDue({
            new: deckStats.new_count ?? 0,
            learn: deckStats.learn_count ?? 0,
            review: deckStats.review_count ?? 0,
          });
        }
      } catch {
        if (!cancelled) setError("Could not load cards. Make sure Anki is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [deckName]);

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
        <h1 className="text-2xl font-bold">{deckName}</h1>
        <div className="flex items-center gap-2">
          {!error && notes && (
            <ImportExport deckName={deckName} notes={notes} />
          )}
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
        <CardList deckName={deckName} notes={notes} suspendedCardIds={suspendedCardIds} />
      )}

      <DeckSettings deckName={deckName} />

      <DangerZone deckName={deckName} />
    </div>
  );
}
