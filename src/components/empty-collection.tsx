import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { createDeck } from "@/lib/decks";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { CardForm } from "./card-form";

interface EmptyCollectionProps {
  /** Deck the first card lands in — usually Anki's stock "Default" deck. */
  deckName: string;
  /** Existing deck names, for the create-deck duplicate check. */
  decks: string[];
  /** Called after a card is saved so Home can reload into the deck view. */
  onCardAdded: () => void;
}

// Shown when the collection has no cards at all (see HomePage). A fresh user
// otherwise saw "Nothing due. You're all caught up." — technically true, but it
// reads as if they'd finished work they never started. This turns that dead end
// into a first step: add a card, or create a deck to organise first.
export function EmptyCollection({
  deckName,
  decks,
  onCardAdded,
}: EmptyCollectionProps) {
  const [adding, setAdding] = useState(false);
  const [creatingDeck, setCreatingDeck] = useState(false);

  return (
    <>
      {/* text-center stays on this inner block so it doesn't cascade into the
          CardForm modal below (which renders inline, not portaled) and centre
          its field labels. */}
      <div className="fade-in flex flex-1 flex-col items-center justify-center pb-[6rem] text-center">
        <h2 className="text-xl font-semibold">Ready when you are</h2>
        <p className="mt-2 max-w-xs text-sm text-foreground/60">
          You don&apos;t have any cards yet. Add your first one to start
          studying.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            <Plus size={16} weight="bold" />
            Add a card
          </button>
          <button
            onClick={() => setCreatingDeck(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-foreground/5"
          >
            Create a deck
          </button>
        </div>
      </div>

      {adding && (
        <CardForm
          deckName={deckName}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onCardAdded();
          }}
        />
      )}

      {creatingDeck && (
        <CreateDeckDialog
          decks={decks}
          onClose={() => setCreatingDeck(false)}
        />
      )}
    </>
  );
}

// Creating the deck here on Home (rather than sending the user to the Decks
// page and opening a dialog there) avoids a jarring page transition where the
// header repaints before the new backdrop lands. We only navigate once the deck
// actually exists — straight to its (empty) page, ready for cards.
function CreateDeckDialog({
  decks,
  onClose,
}: {
  decks: string[];
  onClose: () => void;
}) {
  useScrollLock();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameExists = decks.some(
    (d) => d.toLowerCase() === trimmed.toLowerCase(),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || nameExists) return;
    setCreating(true);
    setError(null);
    try {
      await createDeck(trimmed);
      navigate(`/decks/${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deck");
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Create New Deck</h3>
        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            placeholder="Deck name…"
            className="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          {nameExists ? (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
              A deck named “{trimmed}” already exists.
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
              disabled={creating || !trimmed || nameExists}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create Deck"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
