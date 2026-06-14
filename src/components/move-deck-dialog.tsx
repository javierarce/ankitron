import { useEffect, useMemo, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import {
  compareDeckPaths,
  deckDepth,
  deckLeaf,
  deckParent,
  isCardInDeck,
  joinDeck,
} from "@/lib/deck";

interface MoveDeckDialogProps {
  deckName: string;
  onCancel: () => void;
  /** Receives the full new deck name under the chosen parent. */
  onConfirm: (newName: string) => void;
  moving: boolean;
  error: string | null;
}

const TOP_LEVEL = ""; // sentinel for "no parent"
// "Create a new parent" sentinel. The leading space is deliberate: Anki trims
// deck names, so no real deck path can equal this, keeping it collision-proof.
const NEW_PARENT = " new";

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
  const [choice, setChoice] = useState(currentParent);
  const [newParent, setNewParent] = useState("");

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
        .sort(compareDeckPaths),
    [decks, deckName],
  );

  const creating = choice === NEW_PARENT;
  const parent = creating ? newParent.trim() : choice;
  const unchanged = parent === currentParent;
  const disabled = moving || unchanged || (creating && !newParent.trim());

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
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={moving}
          autoFocus
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none disabled:opacity-60"
        >
          <option value={TOP_LEVEL}>Top level (no parent)</option>
          {candidates.map((d) => (
            <option key={d} value={d}>
              {/* Indent by depth and show only the leaf so the list reads as a
                  tree instead of exposing "::" paths. The indent uses
                  non-breaking spaces — the browser strips leading ASCII spaces
                  from <option> labels. */}
              {"  ".repeat(deckDepth(d)) + deckLeaf(d)}
            </option>
          ))}
          <option value={NEW_PARENT}>+ New parent deck…</option>
        </select>

        {creating && (
          <input
            type="text"
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="New parent deck name"
            autoFocus
            disabled={moving}
            className="mt-2 w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none disabled:opacity-60"
          />
        )}

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
