// The deck page's subdeck navigator: a scoped, collapsible tree of the current
// deck and everything nested under it. It replaces the flat horizontal segment
// chips — same job (scope the card list, drop cards to move them) but laid out
// as a hierarchy you can scan and drill into, and a drop target at every level
// including nested subdecks the chips could never reach. Selection state and
// drag bookkeeping stay with the parent (drags start on its rows); this renders
// the tree and reports clicks/drags back, mirroring the SegmentBar contract.

import {
  Fragment,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import {
  buildSubdeckTree,
  compareDeckPaths,
  deckLeaf,
  formatDeckPath,
  segmentLabelParts,
  type DeckNode,
} from "@/lib/deck";
import { foldText } from "@/lib/fold-text";

// Above this many subdecks the tree gets a filter box; below it the box is just
// clutter for a handful of rows you can already see at a glance.
const FILTER_THRESHOLD = 8;

interface SubdeckTreeProps {
  deckName: string;
  /** Every note in the deck, for the root row's badge. */
  totalCount: number;
  /** One entry per subdeck, in tree order. */
  segmentDecks: string[];
  activeSegments: Set<string>;
  /** Notes in each subdeck's subtree, for the row badges. */
  countByDeck: Map<string, number>;
  /** The deck a card is currently being dragged over, for the drop-target ring. */
  dragOverDeck: string | null;
  /** Plain click on the root: clear the scope (and the shift anchor). */
  onAllClick: () => void;
  onSegmentClick: (deck: string, e: ReactMouseEvent) => void;
  onDragOverDeck: (deck: string) => void;
  onDragLeaveDeck: (deck: string) => void;
  onDropOnDeck: (deck: string) => void;
}

export function SubdeckTree({
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
}: SubdeckTreeProps) {
  const root = useMemo(
    () => buildSubdeckTree(deckName, segmentDecks),
    [deckName, segmentDecks],
  );

  // Collapsed by default past the root's own children, so a deck with many
  // subdecks stays compact.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [query, setQuery] = useState("");
  const q = foldText(query.trim());
  const matches = q
    ? [...segmentDecks].sort(compareDeckPaths).filter((d) => foldText(d).includes(q))
    : null;

  function toggle(fullName: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  function handleDragOver(e: ReactDragEvent, deck: string) {
    e.preventDefault();
    // "copy" so macOS shows a (+) cursor — the plain "move" cursor is
    // indistinguishable from the default arrow, making the rows look inert.
    e.dataTransfer.dropEffect = "copy";
    onDragOverDeck(deck);
  }

  // Shared row chrome for the root, a tree node, and a filter match. A plain
  // render helper (not a nested component) so it can close over the drag state
  // and handlers without tripping the static-components lint. `label` is
  // pre-split so nested matches can dim their path prefix.
  function renderRow({
    deck,
    label,
    count,
    active,
    depth,
    disclosure,
    onClick,
  }: {
    deck: string;
    label: { prefix: string | null; leaf: string };
    count: number;
    active: boolean;
    depth: number;
    disclosure: React.ReactNode;
    onClick: (e: ReactMouseEvent) => void;
  }) {
    const isDragOver = dragOverDeck === deck;
    // The row is a non-interactive drop target wrapping two real controls — the
    // caret (toggle) and the label (scope) — so the caret never nests inside the
    // label button (which would be an invalid nested-interactive control).
    return (
      <div
        onDragOver={(e) => handleDragOver(e, deck)}
        onDragLeave={() => onDragLeaveDeck(deck)}
        onDrop={(e) => {
          e.preventDefault();
          onDropOnDeck(deck);
        }}
        // 8px base inset, equal to the row's right padding (px-2). The caret
        // column already supplies the first level of indentation, so depth 1
        // stays at the base and only depth 2+ steps further in — the tree hugs
        // the left edge rather than drifting right under a phantom slot.
        style={{ paddingLeft: 8 + Math.max(0, depth - 1) * 16 }}
        className={`flex items-center gap-1 rounded-md px-2 transition-colors ${
          active ? "bg-foreground/10" : "hover:bg-foreground/5"
        } ${isDragOver ? "ring-2 ring-inset ring-foreground/40" : ""}`}
      >
        {disclosure}
        <button
          type="button"
          onClick={onClick}
          title={formatDeckPath(deck)}
          // Keep the weight constant across states — bumping to font-medium on
          // select widens the glyphs enough to shift the truncation point. The
          // row's background tint and full-strength colour already mark it.
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm ${
            active ? "text-foreground" : "text-foreground/70"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            {label.prefix && <span className="opacity-50">{label.prefix}</span>}
            {label.leaf}
          </span>
          <span className="shrink-0 tabular-nums text-xs text-foreground/40">
            {count}
          </span>
        </button>
      </div>
    );
  }

  // A fixed-width spacer where a disclosure caret would sit, so leaf-row labels
  // line up under their expandable siblings.
  const caretSpacer = <span className="h-4 w-4 shrink-0" aria-hidden />;

  function renderNode(node: DeckNode, depth: number) {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.fullName);
    const active = activeSegments.has(node.fullName);
    return (
      <Fragment key={node.fullName}>
        {renderRow({
          deck: node.fullName,
          label: { prefix: null, leaf: node.name },
          count: countByDeck.get(node.fullName) ?? 0,
          active,
          depth,
          disclosure: hasChildren ? (
            <button
              type="button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              aria-expanded={isOpen}
              onClick={() => toggle(node.fullName)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-foreground/40 hover:text-foreground/70"
            >
              {isOpen ? (
                <CaretDown size={12} weight="bold" />
              ) : (
                <CaretRight size={12} weight="bold" />
              )}
            </button>
          ) : (
            caretSpacer
          ),
          onClick: (e) => onSegmentClick(node.fullName, e),
        })}
        {hasChildren &&
          isOpen &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </Fragment>
    );
  }

  return (
    <nav
      aria-label="Subdecks"
      data-subdeck-tree
      className="sticky top-4 w-56 shrink-0 self-start max-h-[calc(100vh-6rem)] overflow-y-auto"
    >
      {segmentDecks.length > FILTER_THRESHOLD && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          spellCheck={false}
          placeholder="Filter subdecks…"
          className="mb-2 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none"
        />
      )}

      <div className="space-y-0.5">
        {/* The root row scopes the list back to the whole deck ("All"). It never
            toggles, so it skips the caret spacer and sits flush-left as the head
            of the tree rather than looking indented under a phantom caret. */}
        {renderRow({
          deck: deckName,
          label: { prefix: null, leaf: deckLeaf(deckName) },
          count: totalCount,
          active: activeSegments.size === 0,
          depth: 0,
          disclosure: null,
          onClick: onAllClick,
        })}

        {matches
          ? matches.length === 0
            ? (
                <p className="px-2 py-3 text-sm text-foreground/40">
                  No subdecks match.
                </p>
              )
            : matches.map((deck) => (
                <Fragment key={deck}>
                  {renderRow({
                    deck,
                    // Show the path relative to the viewed deck so a match
                    // reads clearly even with its ancestors out of view.
                    label: segmentLabelParts(deck, deckName),
                    count: countByDeck.get(deck) ?? 0,
                    active: activeSegments.has(deck),
                    depth: 1,
                    disclosure: caretSpacer,
                    onClick: (e) => onSegmentClick(deck, e),
                  })}
                </Fragment>
              ))
          : root.children.map((child) => renderNode(child, 1))}
      </div>
    </nav>
  );
}
