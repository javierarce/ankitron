import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { CenteredSpinner } from "@/components/spinner";
import { fetchAllDueCounts } from "@/lib/anki-fetch";
import { areSuspended, fetchCardDecks } from "@/lib/cards";
import { fetchCardFlags } from "@/lib/flags";
import { compareDeckPaths, deckLeaf, subdecksOf } from "@/lib/deck";
import { fetchDeckNames } from "@/lib/decks";
import { resolveDeckRedirect } from "@/lib/deck-redirects";
import { fetchNotes, findNoteIds } from "@/lib/notes";
import { useSync } from "@/lib/sync-context";
import type { Note, DueCounts } from "@/lib/types";

// Fetch everything the page renders for a deck, in one place so the initial
// (spinner-backed) load and the silent post-edit refresh stay in sync.
async function fetchDeckData(deckName: string) {
  const [noteIds, allDeckNames] = await Promise.all([
    findNoteIds(`deck:"${deckName}"`),
    fetchDeckNames(),
  ]);

  // deckNames is authoritative for existence: a deck reached via a stale
  // history entry (renamed/deleted) won't be in it, and findNotes would just
  // return [] and render a phantom empty deck under the old name.
  const exists = allDeckNames.includes(deckName);

  const subdecks = subdecksOf(allDeckNames, deckName).sort(compareDeckPaths);

  const notes = await fetchNotes(noteIds);

  const allCardIds = notes.flatMap((n) => n.cards ?? []);
  let suspendedCardIds: number[] = [];
  const noteDecks: Record<number, string> = {};
  const noteFlags: Record<number, number> = {};
  if (allCardIds.length > 0) {
    // We only need each card's deck (to scope the list to a subdeck), whether
    // it's suspended, and its flag. getDecks + areSuspended + the flag searches
    // return exactly that; cardsInfo would also make Anki render every card's
    // question/answer HTML server-side, which dominates deck-open time.
    const [cardsByDeck, suspendedFlags, flagByCard] = await Promise.all([
      fetchCardDecks(allCardIds),
      areSuspended(allCardIds),
      fetchCardFlags(allCardIds),
    ]);
    suspendedCardIds = allCardIds.filter((_, i) => suspendedFlags[i] === true);
    const deckByCard = new Map<number, string>();
    for (const [deck, ids] of Object.entries(cardsByDeck)) {
      for (const id of ids) deckByCard.set(id, deck);
    }
    for (const note of notes) {
      const firstCard = (note.cards ?? []).find((id) => deckByCard.has(id));
      const deck = firstCard != null ? deckByCard.get(firstCard) : undefined;
      if (deck) noteDecks[note.noteId] = deck;
      // A note shows the flag of its first flagged card — for the usual
      // single-card note that's just its flag; for a multi-card note it
      // surfaces any flag rather than blank when only a later card carries one.
      const flagged = (note.cards ?? [])
        .map((id) => flagByCard.get(id) ?? 0)
        .find((f) => f > 0);
      if (flagged) noteFlags[note.noteId] = flagged;
    }
  }

  return { subdecks, notes, suspendedCardIds, noteDecks, noteFlags, exists };
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
  // Each note's flag (0 = none), from its first flagged card.
  const [noteFlags, setNoteFlags] = useState<Record<number, number>>({});
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
      const counts = await fetchAllDueCounts([deckName]);
      setDue(counts[deckName] ?? { new: 0, learn: 0, review: 0 });
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
      setNoteFlags(data.noteFlags);
    },
    [],
  );

  // Silent in-place refresh after a card is added, edited, or deleted — no
  // blocking spinner and no full page reload, so the list just updates under
  // the (now-closed) editor. A same-deck single-note edit hands us the updated
  // note; patch it into state instead of refetching the whole deck (notesInfo
  // + getDecks over every note, several round trips on a large deck).
  const refresh = useCallback(async (updatedNote?: Note) => {
    if (updatedNote && notes.some((n) => n.noteId === updatedNote.noteId)) {
      setNotes((prev) =>
        prev.map((n) => (n.noteId === updatedNote.noteId ? updatedNote : n)),
      );
      return;
    }
    try {
      applyData(await fetchDeckData(deckName));
      await refreshDue();
    } catch {
      // Keep the current view if a refresh fails; the user just acted on it.
    }
  }, [deckName, notes, applyData, refreshDue]);

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
    return <CenteredSpinner />;
  }

  const totalDue = due.new + due.learn + due.review;

  // Study always targets the deck the user opened, never a subdeck selected in
  // the list. The title, Settings, and Add note all act on this deck, so Study
  // stays consistent with them; subdeck selection scopes the note list only.
  const studyTo = `/decks/${encodeURIComponent(deckName)}/study`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold" title={deckLeaf(deckName)}>
          {deckLeaf(deckName)}
        </h1>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <Link
            to={`/decks/${encodeURIComponent(deckName)}/settings`}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-foreground/5 transition-colors"
          >
            Settings
          </Link>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-foreground/5 transition-colors"
          >
            Add note
            <kbd className="relative top-px font-sans text-[11px] leading-none text-foreground/30">A</kbd>
          </button>
          {totalDue > 0 ? (
            <Link
              to={studyTo}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              Study
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/30 cursor-not-allowed">
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
          noteFlags={noteFlags}
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
