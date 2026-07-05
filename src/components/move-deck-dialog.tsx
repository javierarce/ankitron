import { useState } from "react";
import { deckLeaf, deckParent, isCardInDeck, joinDeck } from "@/lib/deck";
import { useDeckNames } from "@/hooks/use-deck-names";
import { DeckPicker } from "./deck-picker";
import { ModalDialog } from "./modal-dialog";

interface MoveDeckDialogProps {
  deckName: string;
  onCancel: () => void;
  /** Receives the full new deck name under the chosen parent. */
  onConfirm: (newName: string) => void;
  moving: boolean;
  error: string | null;
}

export function MoveDeckDialog({
  deckName,
  onCancel,
  onConfirm,
  moving,
  error,
}: MoveDeckDialogProps) {
  const leaf = deckLeaf(deckName);
  const currentParent = deckParent(deckName);
  const decks = useDeckNames();
  // The chosen parent path; "" = top level. New parents picked through the
  // picker don't exist yet, but renameDeck creates every target path anyway.
  const [parent, setParent] = useState(currentParent);

  // A deck can't move inside its own subtree, and "Default" is excluded as a
  // parent. Shown disabled (with the reason) rather than hidden, so the tree
  // keeps its shape.
  function disableDeck(deck: string): string | null {
    if (deck === deckName) return "This is the deck being moved";
    if (isCardInDeck(deck, deckName)) return "A deck can't be moved inside itself";
    if (deck === "Default") return "The Default deck can't have subdecks";
    return null;
  }

  const unchanged = parent === currentParent;

  function submit() {
    if (moving || unchanged) return;
    onConfirm(joinDeck(parent, leaf));
  }

  return (
    <ModalDialog
      title="Move Deck"
      titleClassName="mb-1"
      busy={moving}
      onClose={onCancel}
      footer={{
        confirmLabel: "Move",
        busyLabel: "Moving…",
        confirmDisabled: unchanged,
        onConfirm: submit,
      }}
    >
      <p className="mb-4 text-sm text-foreground/50">
        Choose where{" "}
        <strong className="text-foreground/70">{leaf}</strong> should live. Its
        subdecks and cards move with it.
      </p>

      <label className="mb-1 block text-xs text-foreground/50">Move into</label>
      <DeckPicker
        decks={decks}
        value={parent}
        onChange={setParent}
        disable={disableDeck}
        allowTopLevel
        allowCreate
        disabled={moving}
        autoFocus
      />

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </ModalDialog>
  );
}
