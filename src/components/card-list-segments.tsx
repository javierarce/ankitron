// The card list's segmented control: "All" plus one chip per subdeck, each a
// scope filter and a drag-and-drop move target. Selection state and the drag
// bookkeeping stay with the parent (drags start on its rows); this renders the
// chips and reports clicks/drags back.

import { type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  deckLeaf,
  formatDeckPath,
  isCardInDeck,
  segmentLabelParts,
} from "@/lib/deck";

interface SegmentBarProps {
  deckName: string;
  /** Every note in the deck, for the "All" chip's badge. */
  totalCount: number;
  /** One chip per subdeck, in tree order. */
  segmentDecks: string[];
  activeSegments: Set<string>;
  /** Notes in each subdeck's subtree, for the chip badges. */
  countByDeck: Map<string, number>;
  /** The deck a card is currently being dragged over, for drop-target highlight. */
  dragOverDeck: string | null;
  /** Plain click on "All": clear the scope (and the shift anchor). */
  onAllClick: () => void;
  onSegmentClick: (deck: string, e: ReactMouseEvent) => void;
  onDragOverDeck: (deck: string) => void;
  onDragLeaveDeck: (deck: string) => void;
  onDropOnDeck: (deck: string) => void;
}

export function SegmentBar({
  deckName,
  totalCount,
  segmentDecks,
  activeSegments,
  countByDeck,
  dragOverDeck,
  onAllClick,
  onSegmentClick,
  onDragOverDeck,
  onDragLeaveDeck,
  onDropOnDeck,
}: SegmentBarProps) {
  const activeSegmentList = [...activeSegments];

  function handleDragOver(e: ReactDragEvent, deck: string) {
    e.preventDefault();
    // "copy" so macOS shows a (+) cursor — the plain "move" cursor is
    // indistinguishable from the default arrow, making the chips look like
    // they don't accept the drop.
    e.dataTransfer.dropEffect = "copy";
    onDragOverDeck(deck);
  }

  return (
    // A horizontal segmented control: "All" plus one chip per subdeck.
    // Tap to scope the list to a subdeck; drag cards onto a chip to move
    // them there. Scrolls sideways when the decks overflow the row.
    <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      <button
        onClick={onAllClick}
        // Dropping onto "All" moves cards to the root deck — the only way to
        // reach it by drag now that the root has no chip of its own.
        onDragOver={(e) => handleDragOver(e, deckName)}
        onDragLeave={() => onDragLeaveDeck(deckName)}
        onDrop={(e) => {
          e.preventDefault();
          onDropOnDeck(deckName);
        }}
        title={`Drop here to move to ${deckLeaf(deckName)}`}
        className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
          activeSegments.size === 0
            ? "border-foreground bg-foreground text-background"
            : "border-border hover:bg-foreground/5"
        } ${
          dragOverDeck === deckName
            ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
            : ""
        }`}
      >
        All
        <span className="ml-1.5 opacity-50 tabular-nums">{totalCount}</span>
      </button>
      {segmentDecks.map((d) => {
        const active = activeSegments.has(d);
        // A subdeck sitting under a selected parent is part of the scope
        // without being picked itself — give it a lighter highlight so the
        // covered subtree reads at a glance.
        const covered =
          !active && activeSegmentList.some((seg) => isCardInDeck(d, seg));
        const isDragOver = dragOverDeck === d;
        const { prefix, leaf } = segmentLabelParts(d, deckName);
        return (
          <button
            key={d}
            onClick={(e) => onSegmentClick(d, e)}
            onDragOver={(e) => handleDragOver(e, d)}
            onDragLeave={() => onDragLeaveDeck(d)}
            onDrop={(e) => {
              e.preventDefault();
              onDropOnDeck(d);
            }}
            title={formatDeckPath(d)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
              active
                ? "border-foreground bg-foreground text-background"
                : covered
                  ? "border-foreground/30 bg-foreground/10 hover:bg-foreground/15"
                  : "border-border hover:bg-foreground/5"
            } ${
              isDragOver
                ? "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                : ""
            }`}
          >
            {prefix && <span className="opacity-50">{prefix}</span>}
            {leaf}
            <span className="ml-1.5 opacity-50 tabular-nums">
              {countByDeck.get(d) ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
