import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { ankiFetch } from "@/lib/anki-fetch";
import { compareDeckPaths, deckLeaf } from "@/lib/deck";
import { resolveDeckRedirect } from "@/lib/deck-redirects";
import { useSync } from "@/lib/sync-context";
import type { Note, DueCounts } from "@/lib/types";

type CardInfo = { cardId: number; deckName: string; queue: number };

// Fetch everything the page renders for a deck, in one place so the initial
// (spinner-backed) load and the silent post-edit refresh stay in sync.
async function fetchDeckData(deckName: string) {
  const [noteIds, allDeckNames] = await Promise.all([
    ankiFetch<number[]>("findNotes", { query: `deck:"${deckName}"` }),
    ankiFetch<string[]>("deckNames"),
  ]);

  // deckNames is authoritative for existence: a deck reached via a stale
  // history entry (renamed/deleted) won't be in it, and findNotes would just
  // return [] and render a phantom empty deck under the old name.
  const exists = allDeckNames.includes(deckName);

  const subdecks = allDeckNames
    .filter((n) => n.startsWith(deckName + "::"))
    .sort(compareDeckPaths);

  const notes =
    noteIds.length === 0
      ? []
      : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });

  const allCardIds = notes.flatMap((n) => n.cards ?? []);
  let suspendedCardIds: number[] = [];
  const noteDecks: Record<number, string> = {};
  if (allCardIds.length > 0) {
    // One cardsInfo call gives us both each card's deck (to scope the list to a
    // subdeck) and its scheduling queue (-1 means suspended), so we don't need a
    // separate areSuspended round-trip.
    const cards = await ankiFetch<CardInfo[]>("cardsInfo", { cards: allCardIds });
    const byCard = new Map(cards.map((c) => [c.cardId, c]));
    suspendedCardIds = allCardIds.filter((id) => byCard.get(id)?.queue === -1);
    for (const note of notes) {
      const firstCard = (note.cards ?? []).find((id) => byCard.has(id));
      const deck = firstCard != null ? byCard.get(firstCard)?.deckName : undefined;
      if (deck) noteDecks[note.noteId] = deck;
    }
  }

  return { subdecks, notes, suspendedCardIds, noteDecks, exists };
}

export function DeckDetailPage() {
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = decodeURIComponent(rawName!);
  const navigate = useNavigate();

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
  const { registerPageLoad } = useSync();

  // While our blocking spinner is up, suppress the corner sync indicator so the
  // two never show at once.
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);

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

  const applyData = useCallback(
    (data: Awaited<ReturnType<typeof fetchDeckData>>) => {
      setSubdecks(data.subdecks);
      setNotes(data.notes);
      setSuspendedCardIds(data.suspendedCardIds);
      setNoteDecks(data.noteDecks);
    },
    [],
  );

  // Silent in-place refresh after a card is added, edited, or deleted — no
  // blocking spinner and no full page reload, so the list just updates under
  // the (now-closed) editor.
  const refresh = useCallback(async () => {
    try {
      applyData(await fetchDeckData(deckName));
      await refreshDue();
    } catch {
      // Keep the current view if a refresh fails; the user just acted on it.
    }
  }, [deckName, applyData, refreshDue]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDeckData(deckName);
        if (cancelled) return;
        // If the deck no longer exists (landed here via a stale history entry
        // after a rename or delete), forward to its new name when known,
        // otherwise fall back to the deck list. Replace the entry either way so
        // back doesn't return here.
        if (!data.exists) {
          const renamedTo = resolveDeckRedirect(deckName);
          navigate(
            renamedTo ? `/decks/${encodeURIComponent(renamedTo)}` : "/",
            { replace: true },
          );
          return;
        }
        applyData(data);
        if (cancelled) return;
        await refreshDue();
      } catch {
        if (!cancelled) setError("Could not load notes. Make sure Anki is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [deckName, applyData, refreshDue, navigate]);

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
            Add note
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
          onChanged={refresh}
          showAddForm={showAddForm}
          onShowAddForm={setShowAddForm}
        />
      )}
    </div>
  );
}
