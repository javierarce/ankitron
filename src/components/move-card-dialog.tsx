import { useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { formatDeckPath } from "@/lib/deck";
import { moveNotesToDeck } from "@/lib/notes";
import { useDeckNames } from "@/hooks/use-deck-names";
import { DeckPicker } from "./deck-picker";
import { ModalDialog } from "./modal-dialog";

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
  const decks = useDeckNames();
  // No preselected target: with a visible tree, an explicit choice beats
  // silently defaulting to whichever deck happens to sort first.
  const [target, setTarget] = useState<{ deck: string; isNew: boolean } | null>(
    null,
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = notes.length;

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
    <ModalDialog
      title={count === 1 ? "Move Note" : `Move ${count} Notes`}
      titleClassName="mb-1"
      busy={moving}
      onClose={onClose}
      footer={{
        confirmLabel: "Move",
        busyLabel: "Moving…",
        confirmDisabled: target === null,
        onConfirm: handleMove,
      }}
    >
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
    </ModalDialog>
  );
}
