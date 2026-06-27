import { useEffect, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { compareDeckPaths, deckDepth, deckLeaf, formatDeckPath } from "@/lib/deck";
import { useScrollLock } from "@/hooks/use-scroll-lock";

interface MoveCardDialogProps {
  notes: Note[];
  currentDeck: string;
  onClose: () => void;
  /**
   * Called after a successful move instead of reloading the page. The callback
   * owns closing the dialog and refreshing whatever is on screen. Falls back to
   * a full page reload when omitted.
   */
  onMoved?: () => void;
}

// "Create a new deck" sentinel. The leading space is deliberate: Anki trims
// deck names, so no real deck path can equal this, keeping it collision-proof.
const NEW_DECK = " new";

export function MoveCardDialog({ notes, currentDeck, onClose, onMoved }: MoveCardDialogProps) {
  useScrollLock();
  const [decks, setDecks] = useState<string[] | null>(null);
  const [choice, setChoice] = useState("");
  const [newDeck, setNewDeck] = useState("");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = notes.length;

  useEffect(() => {
    let cancelled = false;
    ankiFetch<string[]>("deckNames")
      .then((names) => {
        if (cancelled) return;
        const others = names
          .filter((n) => n !== currentDeck)
          .sort(compareDeckPaths);
        setDecks(others);
        setChoice(others.length > 0 ? others[0] : NEW_DECK);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDeck]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !moving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moving, onClose]);

  const creating = choice === NEW_DECK;
  const target = creating ? newDeck.trim() : choice;
  const disabled = moving || !target;

  async function handleMove() {
    if (!target) return;
    setMoving(true);
    setError(null);
    try {
      let cardIds = notes.flatMap((n) => n.cards ?? []);
      if (cardIds.length === 0) {
        cardIds = await ankiFetch<number[]>("findCards", {
          query: notes.map((n) => `nid:${n.noteId}`).join(" OR "),
        });
      }
      if (cardIds.length === 0) {
        throw new Error(
          count === 1
            ? "Could not find the note to move."
            : "Could not find the notes to move."
        );
      }
      if (creating) {
        await ankiFetch("createDeck", { deck: target });
      }
      await ankiFetch("changeDeck", { cards: cardIds, deck: target });
      // changeDeck writes raw SQL; rebuild Anki's scheduler queues so an
      // active reviewer doesn't keep serving the moved card.
      await ankiFetch("reloadCollection").catch(() => {});
      if (onMoved) {
        onMoved();
      } else {
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move note");
      setMoving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !moving) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">
          {count === 1 ? "Move Note" : `Move ${count} Notes`}
        </h3>
        <p className="mb-4 text-sm text-foreground/50">
          From{" "}
          <strong className="text-foreground/70">
            {formatDeckPath(currentDeck)}
          </strong>
        </p>

        <label className="mb-1 block text-xs text-foreground/50">Move to</label>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={decks === null || moving}
          autoFocus
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none disabled:opacity-60"
        >
          {(decks ?? []).map((d) => (
            <option key={d} value={d}>
              {/* Indent by depth and show only the leaf so the list reads as a
                  tree instead of exposing "::" paths. The indent uses
                  non-breaking spaces — the browser strips leading ASCII spaces
                  from <option> labels. */}
              {"  ".repeat(deckDepth(d)) + deckLeaf(d)}
            </option>
          ))}
          <option value={NEW_DECK}>+ New deck…</option>
        </select>

        {creating && (
          <input
            type="text"
            value={newDeck}
            onChange={(e) => setNewDeck(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleMove();
            }}
            placeholder="New deck name"
            spellCheck={false}
            autoFocus
            disabled={moving}
            className="mt-2 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none disabled:opacity-60"
          />
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={moving}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
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
