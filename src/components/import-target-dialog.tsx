import { useEffect, useState } from "react";
import { formatDeckPath } from "@/lib/deck";
import { useDeckNames } from "@/hooks/use-deck-names";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import type { ExportedDeck } from "@/lib/import-export";
import { CardPreview } from "./card-preview";
import { DeckPicker } from "./deck-picker";

type TargetMode = "new" | "existing";

interface ImportTargetDialogProps {
  parsed: ExportedDeck;
  importing: boolean;
  onCancel: () => void;
  onConfirm: (target: string, isNew: boolean) => void;
}

export function ImportTargetDialog({
  parsed,
  importing,
  onCancel,
  onConfirm,
}: ImportTargetDialogProps) {
  useScrollLock();
  const decks = useDeckNames();
  // "New deck" keeps an editable name (defaulting to the export's own name);
  // "existing" picks from the tree. Kept as two explicit options rather than
  // preseeding the tree with a phantom pending deck — a row that vanishes on
  // deselection and can't be renamed reads as a glitch, not a choice.
  const [mode, setMode] = useState<TargetMode>("new");
  const [newName, setNewName] = useState(parsed.deckName);
  const [picked, setPicked] = useState<{ deck: string; isNew: boolean } | null>(
    null,
  );
  // Once the user touches any control, the deck-list load must not yank the
  // mode from under them.
  const [touched, setTouched] = useState(false);

  // Prefer importing back into the source deck when it exists — the natural
  // round-trip target, and the one noteId matching applies to. Applied when
  // the deck list lands (adjusting state during render, per
  // https://react.dev/learn/you-might-not-need-an-effect); the touched guard
  // keeps it from yanking the mode after the user has made a choice.
  const [prevDecks, setPrevDecks] = useState<string[] | null>(null);
  if (decks !== prevDecks) {
    setPrevDecks(decks);
    if (decks && !touched && decks.includes(parsed.deckName)) {
      setMode("existing");
      setPicked({ deck: parsed.deckName, isNew: false });
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !importing) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importing, onCancel]);

  const target = mode === "new" ? newName.trim() : (picked?.deck ?? "");
  const isNewTarget =
    mode === "new" ? !(decks ?? []).includes(target) : (picked?.isNew ?? false);
  const willMatchByNoteId = target !== "" && target === parsed.deckName;
  const submitDisabled = importing || !target;

  function submit() {
    if (submitDisabled) return;
    onConfirm(target, isNewTarget);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onCancel();
      }}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-lg"
      >
        <h3 className="mb-4 text-lg font-semibold">Import deck</h3>

        {parsed.notes.length > 0 && (
          <div className="mb-6">
            <CardPreview
              notes={parsed.notes}
              title={formatDeckPath(parsed.deckName)}
            />
          </div>
        )}

        <h4 className="mb-3 text-sm font-semibold">Import into deck</h4>

        <div className="space-y-3 text-sm">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="target"
              checked={mode === "new"}
              onChange={() => {
                setTouched(true);
                setMode("new");
              }}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="block">New deck</span>
              {mode === "new" && (
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => {
                    setTouched(true);
                    setNewName(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !submitDisabled) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Deck name"
                  spellCheck={false}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none"
                />
              )}
            </span>
          </label>

          <label
            className={`flex items-start gap-2 ${
              decks !== null && decks.length === 0
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="target"
              checked={mode === "existing"}
              onChange={() => {
                setTouched(true);
                setMode("existing");
              }}
              disabled={decks !== null && decks.length === 0}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="block">Existing deck</span>
              {mode === "existing" && (
                <div className="mt-1">
                  <DeckPicker
                    decks={decks}
                    value={picked?.deck ?? null}
                    onChange={(deck, isNew) => {
                      setTouched(true);
                      setPicked({ deck, isNew });
                    }}
                    allowCreate
                    allowCreateTopLevel={false}
                    disabled={importing}
                  />
                </div>
              )}
            </span>
          </label>

          {/* Only importing into an existing deck needs explaining (update vs
              add-only); a brand-new deck trivially gets everything added. Keyed
              off isNewTarget, not the radio: typing an existing deck's name
              under "New deck" really imports into that deck. */}
          {target !== "" && !isNewTarget && (
            <div className="flex items-start gap-2">
              {/* Invisible radio so the hint lines up with the option content
                  above (radio widths vary by platform, so a fixed padding
                  wouldn't). */}
              <input
                type="radio"
                className="invisible mt-1"
                aria-hidden
                tabIndex={-1}
                disabled
              />
              <p className="flex-1 text-xs text-foreground/60">
                {willMatchByNoteId
                  ? "Notes with matching noteIds will be updated; new ones added."
                  : "All notes will be added as new — noteId matching is skipped for cross-deck imports."}
              </p>
            </div>
          )}
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
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
