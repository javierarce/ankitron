import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteDeckDialog } from "./delete-deck-dialog";
import { canDeleteDeck, subdecksOf } from "@/lib/deck";
import { findNoteIds } from "@/lib/notes";
import { useDeckNames } from "@/hooks/use-deck-names";

interface DangerZoneProps {
  deckName: string;
}

export function DangerZone({ deckName }: DangerZoneProps) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  // Counts power the same "removes N notes" warning the decks list shows — note
  // counts, to match it. Loaded up front so the dialog is accurate the moment it
  // opens; default to 0 until then (the warning still conveys the deletion is
  // final).
  const [noteCount, setNoteCount] = useState(0);
  // Until the note count loads we don't know if an empty Default deck should
  // disable deletion, so keep the button enabled rather than flickering it off.
  const [countsLoaded, setCountsLoaded] = useState(false);
  const allDecks = useDeckNames();
  const subdeckCount = allDecks ? subdecksOf(allDecks, deckName).length : 0;

  useEffect(() => {
    let cancelled = false;
    // `deck:` matches descendants, so this note count already spans subdecks —
    // matching how the decks list counts and warns.
    findNoteIds(`deck:"${deckName}"`)
      .then((noteIds) => {
        if (cancelled) return;
        setNoteCount(noteIds.length);
        setCountsLoaded(true);
      })
      .catch(() => {
        // Leave the count at 0; the warning still conveys the deletion is final.
      });
    return () => {
      cancelled = true;
    };
  }, [deckName]);

  // The Default deck can't be deleted, only emptied — so once it has no notes
  // there's nothing left to do and the button is disabled.
  const deleteDisabled = countsLoaded && !canDeleteDeck(deckName, noteCount);

  return (
    <>
      <section className="mt-16 border-t border-red-500/20 pt-6">
        <h2 className="mb-1 text-sm font-semibold text-red-500">Danger Zone</h2>
        <p className="mb-4 text-sm text-foreground/50">
          {deleteDisabled
            ? "The Default deck can’t be deleted and has no notes to remove."
            : "Permanently delete this deck and all its notes from Anki."}
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={deleteDisabled}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/5 transition-colors dark:border-red-500/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Delete Deck
        </button>
      </section>

      {showConfirm && (
        <DeleteDeckDialog
          deckName={deckName}
          noteCount={noteCount}
          subdeckCount={subdeckCount}
          onCancel={() => setShowConfirm(false)}
          onDeleted={() => navigate("/")}
        />
      )}
    </>
  );
}
