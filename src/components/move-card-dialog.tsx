import { useEffect, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { formatDeckPath } from "@/lib/deck";
import { moveNotesToDeck } from "@/lib/notes";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { DeckPicker } from "./deck-picker";

interface MoveCardDialogProps {
  notes: Note[];
  currentDeck: string;
  onClose: () => void;
  /**
   * Called after a successful move instead of reloading the page. The callback
   * owns closing the dialog and refreshing whatever is on screen. Falls back to
   * a full page reload when omitted.
   */
  onMoved?: () => void;
}

export function MoveCardDialog({ notes, currentDeck, onClose, onMoved }: MoveCardDialogProps) {
  useScrollLock();
  const [decks, setDecks] = useState<string[] | null>(null);
  // No preselected target: with a visible tree, an explicit choice beats
  // silently defaulting to whichever deck happens to sort first.
  const [target, setTarget] = useState<{ deck: string; isNew: boolean } | null>(
    null,
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = notes.length;

  useEffect(() => {
    let cancelled = false;
    ankiFetch<string[]>("deckNames")
      .then((names) => {
        if (!cancelled) setDecks(names);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !moving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moving, onClose]);

  const disabled = moving || target === null;

  async function handleMove() {
    if (target === null) return;
    setMoving(true);
    setError(null);
    try {
      if (target.isNew) {
        await ankiFetch("createDeck", { deck: target.deck });
      }
      await moveNotesToDeck(notes, target.deck);
      if (onMoved) {
        onMoved();
      } else {
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move note");
      setMoving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !moving) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">
          {count === 1 ? "Move Note" : `Move ${count} Notes`}
        </h3>
        <p className="mb-4 text-sm text-foreground/50">
          From{" "}
          <strong className="text-foreground/70">
            {formatDeckPath(currentDeck)}
          </strong>
        </p>

        <label className="mb-1 block text-xs text-foreground/50">Move to</label>
        <DeckPicker
          decks={decks}
          value={target?.deck ?? null}
          onChange={(deck, isNew) => setTarget({ deck, isNew })}
          disable={(deck) =>
            deck === currentDeck
              ? count === 1
                ? "The note is already in this deck"
                : "The notes are already in this deck"
              : null
          }
          allowCreate
          disabled={moving}
          autoFocus
        />

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={moving}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={disabled}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {moving ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
