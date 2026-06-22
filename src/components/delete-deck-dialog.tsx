import { useEffect, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { ankiFetch, fetchNoteCount } from "@/lib/anki-fetch";
import { deckDeleteMessage, formatDeckPath } from "@/lib/deck";

interface DeleteDeckDialogProps {
  deckName: string;
  /**
   * Notes removed by the delete (deck + subdecks), shown in the warning. May be
   * undefined when the caller hasn't loaded counts yet — the Decks page fetches
   * them off its critical path, so the dialog can open first. In that case the
   * dialog counts on demand rather than warning "removes 0 notes" for a deck
   * that actually has notes.
   */
  noteCount?: number;
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
  noteCount,
  subdeckCount,
  onCancel,
  onDeleted,
}: DeleteDeckDialogProps) {
  const [deleting, setDeleting] = useState(false);
  // When the caller didn't pass a count, fetch it on demand so the warning never
  // understates how much is being destroyed.
  const [fetchedCount, setFetchedCount] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    if (noteCount !== undefined) return;
    let cancelled = false;
    fetchNoteCount(deckName).then((count) => {
      if (!cancelled) setFetchedCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [deckName, noteCount]);

  const count = noteCount ?? fetchedCount;
  // While the on-demand count is in flight, warn without asserting a number
  // rather than flashing a misleading "0 notes".
  const message =
    count === undefined
      ? `Permanently delete “${formatDeckPath(deckName)}” and everything in it? This cannot be undone.`
      : deckDeleteMessage(deckName, count, subdeckCount);

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
      message={message}
      onConfirm={handleDelete}
      onCancel={onCancel}
      loading={deleting}
    />
  );
}
