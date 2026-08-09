// The deck picker as an actions-menu panel: the editor's "Move to deck…".
//
// Its selection lives here rather than in the form so that dismissing the menu
// — Cancel, Escape, a click outside — unmounts the panel and forgets the pick.
// Held one level up, a cancelled choice came back pre-selected (and the Move
// button pre-armed) the next time the panel opened.

import { useState } from "react";
import { DeckPicker } from "./deck-picker";
import { failureMessage } from "@/lib/failure-message";

interface MoveToDeckPanelProps {
  /** Every deck name; null while they load (the picker says so itself). */
  decks: string[] | null;
  /** The note's current deck, offered but not selectable. */
  currentDeck: string;
  /**
   * Move the note, creating the deck first when `isNew`. Resolves to whether it
   * landed: a move that failed reports it rather than throwing, and the panel
   * stays open instead of dismissing over the error toast.
   */
  onMove: (deck: string, isNew: boolean) => boolean | Promise<boolean>;
  /** Dismiss the panel — after a move, or on Cancel. */
  onClose: () => void;
}

export function MoveToDeckPanel({
  decks,
  currentDeck,
  onMove,
  onClose,
}: MoveToDeckPanelProps) {
  const [target, setTarget] = useState<{ deck: string; isNew: boolean } | null>(
    null,
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMove() {
    if (!target) return;
    setMoving(true);
    setError(null);
    try {
      if (await onMove(target.deck, target.isNew)) {
        onClose();
      } else {
        // The move itself reported failure and has already said so in a toast;
        // leaving the panel up keeps the chosen deck ready for another go.
        setError("Couldn't move the note. Is Anki still running?");
      }
    } catch (err) {
      // Creating the deck can fail before the move is even attempted; say so
      // here rather than closing as though it worked.
      setError(failureMessage(err, "Couldn't move the note."));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="flex w-72 flex-col gap-3 px-3 py-2">
      <DeckPicker
        decks={decks}
        value={target?.deck ?? null}
        onChange={(deck, isNew) => setTarget({ deck, isNew })}
        disable={(d) =>
          d === currentDeck ? "The note is already in this deck" : null
        }
        allowCreate
        disabled={moving}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!target || moving}
          onClick={handleMove}
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          {moving ? "Moving…" : "Move"}
        </button>
      </div>
    </div>
  );
}
