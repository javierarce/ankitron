import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeleteDeckDialog } from "./delete-deck-dialog";
import { ankiFetch } from "@/lib/anki-fetch";

interface DangerZoneProps {
  deckName: string;
}

export function DangerZone({ deckName }: DangerZoneProps) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  // Counts power the same "removes N notes" warning the decks list shows — note
  // counts, to match it. Loaded up front so the dialog is accurate the moment it
  // opens; default to 0 until then.
  const [noteCount, setNoteCount] = useState(0);
  const [subdeckCount, setSubdeckCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      try {
        // `deck:` matches descendants, so this note count already spans subdecks —
        // matching how the decks list counts and warns. Subdecks are the deck's
        // own "::"-prefixed entries.
        const [noteIds, allDecks] = await Promise.all([
          ankiFetch<number[]>("findNotes", { query: `deck:"${deckName}"` }),
          ankiFetch<string[]>("deckNames"),
        ]);
        if (cancelled) return;
        setNoteCount(noteIds.length);
        setSubdeckCount(
          allDecks.filter((d) => d.startsWith(deckName + "::")).length,
        );
      } catch {
        // Leave the counts at 0; the warning still conveys the deletion is final.
      }
    }
    loadCounts();
    return () => {
      cancelled = true;
    };
  }, [deckName]);

  return (
    <>
      <section className="mt-16 border-t border-red-500/20 pt-6">
        <h2 className="mb-1 text-sm font-semibold text-red-500">Danger Zone</h2>
        <p className="mb-4 text-sm text-foreground/50">
          Permanently delete this deck and all its notes from Anki.
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/5 transition-colors dark:border-red-500/30"
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
