import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardList } from "@/components/card-list";
import { CenteredSpinner } from "@/components/spinner";
import { fetchAllDueCounts } from "@/lib/anki-fetch";
import { areSuspended, fetchCardDecks } from "@/lib/cards";
import { fetchCardFlags } from "@/lib/flags";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import {
  compareDeckPaths,
  deckLeaf,
  deckParent,
  formatDeckPath,
  joinDeck,
  subdecksOf,
} from "@/lib/deck";
import { fetchDeckNames, renameDeck } from "@/lib/decks";
import { recordDeckRedirect, resolveDeckRedirect } from "@/lib/deck-redirects";
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
  // Due counts for the opened deck and each subdeck, so the header's Study
  // action can follow the scoped subdeck the way its title does.
  const [dueByDeck, setDueByDeck] = useState<Record<string, DueCounts>>({});
  // The single subdeck the card list is scoped to (null = the whole deck),
  // reported up by CardList. Drives the header title and its action targets.
  const [scopedDeck, setScopedDeck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  // Inline rename of the deck title. Only the deck's own leaf is editable (the
  // parent path is preserved), matching RenameDeckDialog.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const { registerPageLoad } = useSync();

  // A fresh deck starts unscoped; clear any lingering scope from the previous
  // deck before its card list remounts and reports the new one.
  const [prevDeck, setPrevDeck] = useState(deckName);
  if (deckName !== prevDeck) {
    setPrevDeck(deckName);
    setScopedDeck(null);
    // Leave any half-open rename behind with the old deck.
    setEditingName(false);
    setRenameError(null);
  }

  // While our blocking spinner is up, suppress the corner sync indicator so the
  // two never show at once.
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);

  const refreshDue = useCallback(async (subdeckList: string[]) => {
    try {
      setDueByDeck(await fetchAllDueCounts([deckName, ...subdeckList]));
    } catch {
      // keep the previous counts
    }
  }, [deckName]);

  // The view-scoped refresh used after in-place edits, over the subdecks
  // already in state.
  const refreshDueForView = useCallback(
    () => refreshDue(subdecks),
    [refreshDue, subdecks],
  );

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
      // Use the just-fetched subdeck list, not the subdecks still in state — a
      // refresh can surface a brand-new subdeck (a move or add that created a
      // deck), and refreshDueForView would miss its due counts until the next
      // full load.
      const data = await fetchDeckData(deckName);
      applyData(data);
      await refreshDue(data.subdecks);
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
        await refreshDue(data.subdecks);
      } catch {
        if (!cancelled) setError("Could not load notes. Make sure Anki is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [deckName, applyData, refreshDue, navigate]);

  // Rename follows the scoped subdeck the way the header's other actions do: a
  // selected subdeck is what you rename, not the deck the page opened on.
  function startRename() {
    setNameDraft(deckLeaf(scopedDeck ?? deckName));
    setRenameError(null);
    setEditingName(true);
  }

  function cancelRename() {
    setEditingName(false);
    setRenameError(null);
  }

  async function applyRename() {
    const target = scopedDeck ?? deckName;
    const trimmed = nameDraft.trim();
    const currentLeaf = deckLeaf(target);
    if (trimmed.includes("::")) {
      setRenameError("A deck name can’t contain “::”. Use Settings → Move.");
      return;
    }
    // Empty or a case-only change (Anki matches names case-insensitively) is a
    // no-op — just drop out of edit mode.
    if (!trimmed || trimmed.toLowerCase() === currentLeaf.toLowerCase()) {
      cancelRename();
      return;
    }
    const newName = joinDeck(deckParent(target), trimmed);
    setRenameBusy(true);
    setRenameError(null);
    try {
      const renames = await renameDeck(target, newName);
      // Forward stale history entries (e.g. cmd+left onto the pre-rename deck)
      // to the new name instead of dead-ending.
      for (const { from, to } of renames) recordDeckRedirect(from, to);
      setRenameBusy(false);
      setEditingName(false);
      if (renames.length === 0) return;
      // Land on the renamed deck — its own page when a subdeck was scoped.
      // Renaming the opened deck invalidates the current history entry (its old
      // name is gone), so replace it. A scoped rename leaves the current entry —
      // the parent deck's URL — still valid, so push instead to keep Back
      // returning to the parent rather than skipping it.
      navigate(`/decks/${encodeURIComponent(newName)}`, { replace: !scopedDeck });
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed.");
      setRenameBusy(false);
    }
  }

  if (loading) {
    return <CenteredSpinner />;
  }

  // The header follows the scoped subdeck: its title names it and Study,
  // Settings, and Add note all act on it. Falls back to the opened deck when the
  // list is scoped to "All" (or to several subdecks at once).
  const targetDeck = scopedDeck ?? deckName;
  const encodedTarget = encodeURIComponent(targetDeck);
  const due = dueByDeck[targetDeck] ?? { new: 0, learn: 0, review: 0 };
  const totalDue = due.new + due.learn + due.review;
  const studyTo = `/decks/${encodedTarget}/study`;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-baseline gap-2 text-2xl">
            {/* When scoped to a subdeck, the opened deck's title stays put and
                the subdeck — set apart in a lighter weight and muted colour —
                is what rename edits, matching the header's other actions. */}
            {scopedDeck && (
              <span className="truncate font-bold" title={formatDeckPath(deckName)}>
                {deckLeaf(deckName)}
              </span>
            )}
            {editingName ? (
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyRename();
                  else if (e.key === "Escape") cancelRename();
                }}
                onBlur={() => {
                  if (!renameBusy) cancelRename();
                }}
                spellCheck={false}
                autoFocus
                disabled={renameBusy}
                aria-label={scopedDeck ? "Subdeck name" : "Deck name"}
                className={`min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-0.5 focus:border-foreground/40 focus:outline-none disabled:opacity-60 ${
                  scopedDeck ? "font-normal text-foreground/50" : "font-bold"
                }`}
              />
            ) : (
              // Click the title (or its hover pencil) to rename in place.
              <button
                type="button"
                onClick={startRename}
                title={scopedDeck ? "Rename subdeck" : "Rename deck"}
                className="group flex min-w-0 items-baseline gap-1.5 text-left"
              >
                <span
                  className={`truncate ${
                    scopedDeck ? "font-normal text-foreground/50" : "font-bold"
                  }`}
                  title={formatDeckPath(targetDeck)}
                >
                  {deckLeaf(targetDeck)}
                </span>
                <PencilSimple
                  size={15}
                  weight="bold"
                  className="shrink-0 self-center text-transparent transition-colors group-hover:text-foreground/40"
                />
              </button>
            )}
          </h1>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <Link
              to={`/decks/${encodedTarget}/settings`}
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
        {renameError && (
          <p className="mt-2 text-sm text-red-500">{renameError}</p>
        )}
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
          onSuspendChange={refreshDueForView}
          onCardsMoved={refreshDueForView}
          onChanged={refresh}
          showAddForm={showAddForm}
          onShowAddForm={setShowAddForm}
          onScopeChange={setScopedDeck}
        />
      )}
    </div>
  );
}
