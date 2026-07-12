// Which segments (subdeck chips) are active. Empty = "All"; otherwise the card
// list is scoped to the union of these exact deck names. Cmd/Ctrl+click toggles
// a segment into the set; Shift+click extends a range from the last-clicked
// one; a plain click selects just one (or clears it back to "All").

import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

interface UseDeckSegmentsOptions {
  /** The chips, in row order — Shift+click ranges follow it. */
  segmentDecks: string[];
}

export function useDeckSegments({ segmentDecks }: UseDeckSegmentsOptions) {
  const [activeSegments, setActiveSegments] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // The last segment clicked, used as the anchor for Shift+click ranges.
  const [lastSegment, setLastSegment] = useState<string | null>(null);

  function handleSegmentClick(deck: string, e: ReactMouseEvent) {
    const anchor = lastSegment;
    if (e.shiftKey && anchor) {
      // Add every segment between the anchor and this one (inclusive) to the
      // current selection, ordered by the chip row (deck + its subdecks).
      const anchorIdx = segmentDecks.indexOf(anchor);
      const clickedIdx = segmentDecks.indexOf(deck);
      if (anchorIdx !== -1 && clickedIdx !== -1) {
        const [start, end] =
          anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        setActiveSegments((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(segmentDecks[i]);
          return next;
        });
        setLastSegment(deck);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setActiveSegments((prev) => {
        const next = new Set(prev);
        if (next.has(deck)) next.delete(deck);
        else next.add(deck);
        return next;
      });
    } else {
      // Plain click: select just this segment, or clear it if it was already
      // the sole selection.
      setActiveSegments((prev) =>
        prev.size === 1 && prev.has(deck) ? new Set() : new Set([deck]),
      );
    }
    setLastSegment(deck);
  }

  // Back to "All": the "All" chip's click, and the reset when navigating to a
  // different deck. State-only, so it's safe to call from the caller's
  // adjust-state-during-render block.
  const clearSegments = useCallback(() => {
    setActiveSegments(new Set());
    setLastSegment(null);
  }, []);

  return { activeSegments, handleSegmentClick, clearSegments };
}
