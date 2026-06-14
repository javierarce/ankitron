import { useEffect, useState } from "react";

interface RenameDeckDialogProps {
  deckName: string;
  onCancel: () => void;
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
  const [name, setName] = useState(deckName);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !renaming) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renaming, onCancel]);

  const trimmed = name.trim();
  // A name that only differs by case is a no-op (Anki matches names
  // case-insensitively), so treat it like the unchanged name.
  const disabled =
    renaming || !trimmed || trimmed.toLowerCase() === deckName.toLowerCase();

  function submit() {
    if (disabled) return;
    onConfirm(trimmed);
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
          Subdecks and their cards move along with the deck. Use{" "}
          <code className="text-foreground/70">::</code> to nest it under another
          deck.
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Deck name"
          autoFocus
          disabled={renaming}
          className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none disabled:opacity-60"
        />

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
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {renaming ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
