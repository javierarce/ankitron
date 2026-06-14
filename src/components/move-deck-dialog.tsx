import { useEffect, useMemo, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import { deckLeaf, deckParent, isCardInDeck, joinDeck } from "@/lib/deck";

interface MoveDeckDialogProps {
  deckName: string;
  onCancel: () => void;
  /** Receives the full new deck name under the chosen parent. */
  onConfirm: (newName: string) => void;
  moving: boolean;
  error: string | null;
}

const TOP_LEVEL = ""; // sentinel for "no parent"

export function MoveDeckDialog({
  deckName,
  onCancel,
  onConfirm,
  moving,
  error,
}: MoveDeckDialogProps) {
  const leaf = deckLeaf(deckName);
  const currentParent = deckParent(deckName);
  const [decks, setDecks] = useState<string[]>([]);
  const [parent, setParent] = useState(currentParent);

  useEffect(() => {
    let cancelled = false;
    ankiFetch<string[]>("deckNames")
      .then((names) => {
        if (!cancelled) setDecks(names);
      })
      .catch(() => {});
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

  // Valid parents are every deck except the deck itself and its own subtree
  // (you can't move a deck inside itself). "Default" is excluded as a parent.
  const candidates = useMemo(
    () =>
      decks
        .filter((d) => !isCardInDeck(d, deckName) && d !== "Default")
        .sort((a, b) => a.localeCompare(b)),
    [decks, deckName],
  );

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
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Move Deck</h3>
        <p className="mb-4 text-sm text-foreground/50">
          Choose where{" "}
          <strong className="text-foreground/70">{leaf}</strong> should live. Its
          subdecks and cards move with it.
        </p>

        <label className="mb-1 block text-xs text-foreground/50">Move into</label>
        <select
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          disabled={moving}
          autoFocus
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none disabled:opacity-60"
        >
          <option value={TOP_LEVEL}>Top level (no parent)</option>
          {candidates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

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
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {moving ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
