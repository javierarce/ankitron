import { useEffect, useRef, useState } from "react";
import { createDeck } from "@/lib/decks";
import { ModalDialog } from "./modal-dialog";

interface CreateDeckDialogProps {
  /**
   * Existing deck names, used to warn about a case-insensitive duplicate
   * before submitting — Anki's createDeck silently returns the existing deck,
   * so without this a "create" would just navigate to it with no feedback.
   */
  decks: string[];
  onClose: () => void;
  /** Called with the created deck's name after a successful create. */
  onCreated: (name: string) => void;
}

// The "Create New Deck" dialog shared by the Decks page and the command
// palette. Owns its own input/busy/error state and the duplicate guard; the
// caller decides what happens after a create (typically navigate to the deck).
export function CreateDeckDialog({
  decks,
  onClose,
  onCreated,
}: CreateDeckDialogProps) {
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const trimmedNewName = newDeckName.trim();
  const deckNameExists = decks.some(
    (d) => d.toLowerCase() === trimmedNewName.toLowerCase(),
  );

  async function handleCreateDeck(e: React.FormEvent) {
    e.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
    // Anki's createDeck silently returns the existing deck, so guard here —
    // otherwise "creating" a duplicate just navigates to it with no feedback.
    if (decks.some((d) => d.toLowerCase() === name.toLowerCase())) {
      setError("A deck with this name already exists.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createDeck(name);
      onCreated(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deck");
      setCreating(false);
    }
  }

  return (
    <ModalDialog title="Create New Deck" busy={creating} onClose={onClose}>
      <form onSubmit={handleCreateDeck}>
        <input
          ref={inputRef}
          type="text"
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          spellCheck={false}
          placeholder="Deck name…"
          className="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />
        {deckNameExists ? (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
            A deck named “{trimmedNewName}” already exists.
          </p>
        ) : error ? (
          <p className="mt-2 text-sm text-red-500">{error}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !trimmedNewName || deckNameExists}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create Deck"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
