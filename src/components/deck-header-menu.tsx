import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { canDeleteDeck } from "@/lib/deck";
import { renameDeckPrefs } from "@/lib/deck-prefs";
import { recordDeckRedirect } from "@/lib/deck-redirects";
import { renameDeck } from "@/lib/decks";
import { exportDeckToJson } from "@/lib/import-export";
import { ActionsMenu } from "./actions-menu";
import { DeleteDeckDialog } from "./delete-deck-dialog";
import { ImportResultModal } from "./import-result-modal";
import { MoveDeckDialog } from "./move-deck-dialog";

interface DeckHeaderMenuProps {
  /** The deck to act on — the scoped subdeck when the list has one selected. */
  deck: string;
  /**
   * Whether `deck` is the deck the page opened on rather than a scoped subdeck.
   * Only affects where a move lands (see handleMove).
   */
  isOpenedDeck: boolean;
  /**
   * Notes in this deck and its subdecks — what a delete would destroy. The page
   * already has them, so passing the count keeps the confirm dialog honest
   * without a round trip (and tells us whether an empty Default deck has
   * anything left to remove).
   */
  noteCount: number;
  /** Subdecks that would go with it, likewise already known to the page. */
  subdeckCount: number;
}

/**
 * The deck page header's "⋮" menu: everything you can do to a deck that isn't
 * Add note or Study. Move, Export, and Delete live here rather than on the deck
 * settings page — they act on a deck, they don't configure one, which leaves
 * that page to the deck's actual options.
 *
 * No Import: every item here acts on `deck`, and an import doesn't — its target
 * comes from the file (ImportTargetDialog preselects the export's own deck), so
 * sitting it beside a deck-scoped Export would promise a scoping it can't keep.
 * It stays on the Decks page header, alongside the app-wide file drop.
 *
 * Its own component because each item drags a dialog behind it (the move flow,
 * the delete confirm, an export error), and the deck page is long enough.
 */
export function DeckHeaderMenu({
  deck,
  isOpenedDeck,
  noteCount,
  subdeckCount,
}: DeckHeaderMenuProps) {
  const navigate = useNavigate();
  const [showMove, setShowMove] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Export failures reuse the import result modal purely as an error display,
  // the same way the decks list does.
  const [exportError, setExportError] = useState<string | null>(null);

  const encoded = encodeURIComponent(deck);
  // The Default deck can't be deleted, only emptied — so once it holds nothing
  // there's no delete left to offer.
  const canDelete = canDeleteDeck(deck, noteCount);

  async function handleMove(newName: string) {
    setMoving(true);
    setMoveError(null);
    try {
      const renames = await renameDeck(deck, newName);
      setMoving(false);
      setShowMove(false);
      // No-op (e.g. the same parent picked again) — nothing moved.
      if (renames.length === 0) return;
      // Forward stale history entries (a back button onto the pre-move path) to
      // where each deck ended up instead of dead-ending.
      for (const { from, to } of renames) recordDeckRedirect(from, to);
      // The deck's own preferences are keyed by name, so they move with it.
      renameDeckPrefs(renames);
      // Follow the deck to its new home. Reloading at the new name beats
      // patching in place: a moved subdeck has just left this page's subtree, so
      // its chip, its notes, and the scope pointing at it are all stale. Moving
      // the opened deck replaces the entry (its URL is now dead); moving a
      // subdeck pushes, since the parent page behind it is still good.
      navigate(`/decks/${encodeURIComponent(newName)}`, {
        replace: isOpenedDeck,
      });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Move failed.");
      setMoving(false);
    }
  }

  async function handleExport() {
    setExportError(null);
    try {
      // No notes passed: exportDeckToJson fetches the deck's own, which is what
      // we want when the header is scoped to a subdeck.
      await exportDeckToJson(deck);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  return (
    <>
      <ActionsMenu
        label="Deck actions"
        menuClassName="min-w-[140px]"
        // The default vertical "⋮" glyph, same as the note and deck rows.
        iconSize={20}
        // Borderless: a third bordered box would read as a third button
        // competing with Add note and Study. But not the /30 of a row kebab
        // either — a row's fades back because it repeats down the list, whereas
        // this one is a peer of the two buttons beside it and has to hold its
        // own against their full-strength labels (/30 also misses the 3:1
        // contrast an icon-only control needs).
        triggerClassName={(open) =>
          `flex shrink-0 items-center rounded-lg p-2 transition-colors hover:bg-foreground/5 hover:text-foreground ${
            open ? "bg-foreground/5 text-foreground" : "text-foreground/70"
          }`
        }
        items={[
          { label: "Move", onSelect: () => setShowMove(true) },
          { label: "Export", onSelect: handleExport },
          {
            // The Stats page takes its deck scope from the URL. Built with
            // URLSearchParams, not encodeURIComponent: the latter leaves "+"
            // alone and a query parser reads it back as a space, so a deck named
            // "C++" would arrive as "C  ".
            label: "Stats",
            onSelect: () => navigate(`/stats?${new URLSearchParams({ deck })}`),
          },
          {
            label: "Settings",
            onSelect: () => navigate(`/decks/${encoded}/settings`),
          },
          {
            label: "Delete deck",
            danger: true,
            disabled: !canDelete,
            title: canDelete
              ? undefined
              : "The Default deck has no notes to remove",
            onSelect: () => setShowDelete(true),
          },
        ]}
      />

      {showMove && (
        <MoveDeckDialog
          deckName={deck}
          moving={moving}
          error={moveError}
          onCancel={() => {
            setShowMove(false);
            setMoveError(null);
          }}
          onConfirm={handleMove}
        />
      )}

      {showDelete && (
        <DeleteDeckDialog
          deckName={deck}
          noteCount={noteCount}
          subdeckCount={subdeckCount}
          onCancel={() => setShowDelete(false)}
          // The page we're on describes a deck that no longer exists — and if a
          // subdeck was deleted, the list around it is stale too. Fall back to
          // the deck list rather than trying to patch either in place.
          onDeleted={() => navigate("/decks")}
        />
      )}

      {exportError && (
        <ImportResultModal
          result={null}
          error={exportError}
          errorTitle="Export failed"
          onClose={() => setExportError(null)}
        />
      )}
    </>
  );
}
