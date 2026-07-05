import { useState } from "react";
import { deckLeaf, deckParent, formatDeckPath, joinDeck } from "@/lib/deck";
import { ModalDialog } from "./modal-dialog";

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
    <ModalDialog
      title="Rename Deck"
      titleClassName="mb-1"
      busy={renaming}
      onClose={onCancel}
      footer={{
        confirmLabel: "Rename",
        busyLabel: "Renaming…",
        confirmDisabled: !trimmed || hasSeparator ||
          trimmed.toLowerCase() === currentLeaf.toLowerCase(),
        onConfirm: submit,
      }}
    >
      <p className="mb-4 text-sm text-foreground/50">
        {parent ? (
          <>
            Renames this deck inside{" "}
            <strong className="text-foreground/70">
              {formatDeckPath(parent)}
            </strong>
            . Subdecks and their notes come along.
          </>
        ) : (
          <>Subdecks and their notes come along with the deck.</>
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
        spellCheck={false}
        autoFocus
        disabled={renaming}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none disabled:opacity-60"
      />

      {hasSeparator && (
        <p className="mt-2 text-xs text-foreground/50">
          A deck name can&apos;t contain &ldquo;::&rdquo;. Use Move to put this
          deck inside another.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </ModalDialog>
  );
}
