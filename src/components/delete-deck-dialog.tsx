import { useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { deckDeleteMessage } from "@/lib/deck";

interface DeleteDeckDialogProps {
  deckName: string;
  /** Cards removed by the delete (deck + subdecks), shown in the warning. */
  cardCount: number;
  /** Subdecks removed alongside it, shown in the warning. */
  subdeckCount: number;
  onCancel: () => void;
  /** Called after the deck is deleted from Anki (e.g. to navigate or refresh). */
  onDeleted: () => void;
}

/**
 * The single confirm-and-delete-a-deck flow. Every place that deletes a deck
 * renders this so the wording, the destructive `deleteDecks` call, and the
 * busy/retry handling stay identical instead of being re-implemented per page.
 */
export function DeleteDeckDialog({
  deckName,
  cardCount,
  subdeckCount,
  onCancel,
  onDeleted,
}: DeleteDeckDialogProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await ankiFetch("deleteDecks", { decks: [deckName], cardsToo: true });
      onDeleted();
    } catch {
      // Leave the dialog open so the user can retry.
      setDeleting(false);
    }
  }

  return (
    <ConfirmDialog
      title="Delete Deck"
      message={deckDeleteMessage(deckName, cardCount, subdeckCount)}
      onConfirm={handleDelete}
      onCancel={onCancel}
      loading={deleting}
    />
  );
}
