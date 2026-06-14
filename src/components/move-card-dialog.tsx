import { useEffect, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { formatDeckPath } from "@/lib/deck";

interface MoveCardDialogProps {
  note: Note;
  currentDeck: string;
  onClose: () => void;
}

export function MoveCardDialog({ note, currentDeck, onClose }: MoveCardDialogProps) {
  const [decks, setDecks] = useState<string[] | null>(null);
  const [pickedDeck, setPickedDeck] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ankiFetch<string[]>("deckNames")
      .then((names) => {
        if (cancelled) return;
        const others = names.filter((n) => n !== currentDeck);
        setDecks(others);
        if (others.length > 0) setPickedDeck(others[0]);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDeck]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !moving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moving, onClose]);

  async function handleMove() {
    if (!pickedDeck) return;
    setMoving(true);
    setError(null);
    try {
      let cardIds = note.cards ?? [];
      if (cardIds.length === 0) {
        cardIds = await ankiFetch<number[]>("findCards", {
          query: `nid:${note.noteId}`,
        });
      }
      if (cardIds.length === 0) {
        throw new Error("Could not find the card to move.");
      }
      await ankiFetch("changeDeck", { cards: cardIds, deck: pickedDeck });
      // changeDeck writes raw SQL; rebuild Anki's scheduler queues so an
      // active reviewer doesn't keep serving the moved card.
      await ankiFetch("reloadCollection").catch(() => {});
      onClose();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
      setMoving(false);
    }
  }

  const noOtherDecks = decks !== null && decks.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !moving) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Move Card</h3>
        <p className="mb-4 text-sm text-foreground/50">
          From{" "}
          <strong className="text-foreground/70">
            {formatDeckPath(currentDeck)}
          </strong>
        </p>

        {noOtherDecks ? (
          <p className="mb-6 text-sm text-foreground/60">
            There are no other decks to move this card to.
          </p>
        ) : (
          <div className="mb-6">
            <label className="mb-1.5 block text-sm font-medium text-foreground/70">
              Move to
            </label>
            <select
              value={pickedDeck}
              onChange={(e) => setPickedDeck(e.target.value)}
              disabled={decks === null || moving}
              autoFocus
              className="w-full rounded-md border border-foreground/10 bg-transparent px-2 py-1.5 text-sm focus:border-foreground/30 focus:outline-none"
            >
              {(decks ?? []).map((d) => (
                <option key={d} value={d}>
                  {formatDeckPath(d)}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={moving}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={moving || !pickedDeck || noOtherDecks}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {moving ? "Moving..." : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
