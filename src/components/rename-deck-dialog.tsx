import { useEffect, useState } from "react";
import { deckLeaf, deckParent, formatDeckPath, joinDeck } from "@/lib/deck";

interface RenameDeckDialogProps {
  deckName: string;
  onCancel: () => void;
  /** Receives the full new deck name (parent path preserved). */
  onConfirm: (newName: string) => void;
  renaming: boolean;
  error: string | null;
}

export function RenameDeckDialog({
  deckName,
  onCancel,
  onConfirm,
  renaming,
  error,
}: RenameDeckDialogProps) {
  // Only the deck's own name is editable; the parent path stays put (use Move to
  // change it), so users never have to deal with "::".
  const parent = deckParent(deckName);
  const currentLeaf = deckLeaf(deckName);
  const [leaf, setLeaf] = useState(currentLeaf);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !renaming) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renaming, onCancel]);

  const trimmed = leaf.trim();
  const hasSeparator = trimmed.includes("::");
  // A name that only differs by case is a no-op (Anki matches names
  // case-insensitively), so treat it like the unchanged name.
  const disabled =
    renaming ||
    !trimmed ||
    hasSeparator ||
    trimmed.toLowerCase() === currentLeaf.toLowerCase();

  function submit() {
    if (disabled) return;
    onConfirm(joinDeck(parent, trimmed));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !renaming) onCancel();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Rename Deck</h3>
        <p className="mb-4 text-sm text-foreground/50">
          {parent ? (
            <>
              Renames this deck inside{" "}
              <strong className="text-foreground/70">
                {formatDeckPath(parent)}
              </strong>
              . Subdecks and their cards come along.
            </>
          ) : (
            <>Subdecks and their cards come along with the deck.</>
          )}
        </p>

        <input
          type="text"
          value={leaf}
          onChange={(e) => setLeaf(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Deck name"
          autoFocus
          disabled={renaming}
          className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none disabled:opacity-60"
        />

        {hasSeparator && (
          <p className="mt-2 text-xs text-foreground/50">
            A deck name can&apos;t contain &ldquo;::&rdquo;. Use Move to put this
            deck inside another.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={renaming}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={disabled}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {renaming ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
