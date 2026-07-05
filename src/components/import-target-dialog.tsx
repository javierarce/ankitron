import { useState } from "react";
import { formatDeckPath } from "@/lib/deck";
import { useDeckNames } from "@/hooks/use-deck-names";
import type { ExportedDeck } from "@/lib/import-export";
import { CardPreview } from "./card-preview";
import { DeckPicker } from "./deck-picker";
import { ModalDialog } from "./modal-dialog";

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
    <ModalDialog
      title="Import deck"
      width="2xl"
      scrollable
      busy={importing}
      onClose={onCancel}
      footer={{
        confirmLabel: "Import",
        busyLabel: "Importing…",
        confirmDisabled: !target,
        onConfirm: submit,
      }}
    >
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
    </ModalDialog>
  );
}
