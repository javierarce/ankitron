import { useEffect, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import { formatDeckPath } from "@/lib/deck";
import type { ExportedDeck } from "@/lib/import-export";

type TargetMode = "current" | "existing" | "new";

interface ImportTargetDialogProps {
  parsed: ExportedDeck;
  /** When set, the "current deck" option is shown and defaulted. */
  currentDeck?: string;
  importing: boolean;
  onCancel: () => void;
  onConfirm: (target: string, isNew: boolean) => void;
}

export function ImportTargetDialog({
  parsed,
  currentDeck,
  importing,
  onCancel,
  onConfirm,
}: ImportTargetDialogProps) {
  const sourceMatchesCurrent =
    currentDeck !== undefined && parsed.deckName === currentDeck;
  const [mode, setMode] = useState<TargetMode>(
    currentDeck !== undefined ? (sourceMatchesCurrent ? "current" : "new") : "new",
  );
  const [newName, setNewName] = useState(
    sourceMatchesCurrent ? `${parsed.deckName} (copy)` : parsed.deckName,
  );
  const [decks, setDecks] = useState<string[]>([]);
  const [pickedDeck, setPickedDeck] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    ankiFetch<string[]>("deckNames")
      .then((names) => {
        if (cancelled) return;
        const others = names.filter((n) => n !== currentDeck);
        setDecks(others);
        if (others.length > 0) {
          // Prefer the source deck if present — that's the natural target for
          // a round-trip when the user is on a different page.
          const preferred = others.includes(parsed.deckName)
            ? parsed.deckName
            : others[0];
          setPickedDeck(preferred);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentDeck, parsed.deckName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !importing) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importing, onCancel]);

  function effectiveTarget(): string {
    if (mode === "current") return currentDeck ?? "";
    if (mode === "existing") return pickedDeck;
    return newName.trim();
  }

  const target = effectiveTarget();
  const willMatchByNoteId = target !== "" && target === parsed.deckName;

  function submit() {
    if (mode === "current") {
      if (!currentDeck) return;
      return onConfirm(currentDeck, false);
    }
    if (mode === "existing") {
      if (!pickedDeck) return;
      return onConfirm(pickedDeck, false);
    }
    const name = newName.trim();
    if (!name) return;
    onConfirm(name, true);
  }

  const submitDisabled =
    importing ||
    (mode === "current" && !currentDeck) ||
    (mode === "existing" && !pickedDeck) ||
    (mode === "new" && !newName.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onCancel();
      }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg"
      >
        <h3 className="mb-1 text-lg font-semibold">Import into deck</h3>
        <p className="mb-4 text-sm text-foreground/50">
          From{" "}
          <strong className="text-foreground/70">
            {formatDeckPath(parsed.deckName)}
          </strong>{" "}
          · {parsed.notes.length}{" "}
          {parsed.notes.length === 1 ? "card" : "cards"}
        </p>

        <div className="space-y-3 text-sm">
          {currentDeck !== undefined && (
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="target"
                checked={mode === "current"}
                onChange={() => setMode("current")}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="block">
                  Current deck: <strong>{formatDeckPath(currentDeck)}</strong>
                </span>
              </span>
            </label>
          )}

          <label
            className={`flex items-start gap-2 ${
              decks.length === 0
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="target"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={decks.length === 0}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="block">Existing deck</span>
              {mode === "existing" && (
                <select
                  value={pickedDeck}
                  onChange={(e) => setPickedDeck(e.target.value)}
                  className="mt-1 w-full rounded-md border border-foreground/10 bg-transparent px-2 py-1 text-sm focus:border-foreground/30 focus:outline-none"
                >
                  {decks.map((d) => (
                    <option key={d} value={d}>
                      {formatDeckPath(d)}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="target"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="block">New deck</span>
              {mode === "new" && (
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Deck name"
                  autoFocus
                  className="mt-1 w-full rounded-md border border-foreground/10 bg-transparent px-2 py-1 text-sm placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none"
                />
              )}
            </span>
          </label>

          <p className="rounded-md bg-foreground/5 px-3 py-2 text-xs text-foreground/60">
            {willMatchByNoteId
              ? "Cards with matching noteIds will be updated; new ones added."
              : "All cards will be added as new — noteId matching is skipped for cross-deck imports."}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={importing}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitDisabled}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
