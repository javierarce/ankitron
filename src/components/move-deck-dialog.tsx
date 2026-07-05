import { useEffect, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import {
  deckLeaf,
  deckParent,
  isCardInDeck,
  isDefaultDeck,
  joinDeck,
} from "@/lib/deck";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { DeckPicker } from "./deck-picker";

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
  useScrollLock();
  const leaf = deckLeaf(deckName);
  const currentParent = deckParent(deckName);
  const [decks, setDecks] = useState<string[] | null>(null);
  // The chosen parent path; "" = top level. New parents picked through the
  // picker don't exist yet, but renameDeck creates every target path anyway.
  const [parent, setParent] = useState(currentParent);

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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !moving) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving, onCancel]);

  // A deck can't move inside its own subtree, and "Default" is excluded as a
  // parent. Shown disabled (with the reason) rather than hidden, so the tree
  // keeps its shape.
  function disableDeck(deck: string): string | null {
    if (deck === deckName) return "This is the deck being moved";
    if (isCardInDeck(deck, deckName)) return "A deck can't be moved inside itself";
    if (isDefaultDeck(deck)) return "The Default deck can't have subdecks";
    return null;
  }

  const unchanged = parent === currentParent;
  const disabled = moving || unchanged;

  function submit() {
    if (disabled) return;
    onConfirm(joinDeck(parent, leaf));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !moving) onCancel();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Move Deck</h3>
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

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={moving}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
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
