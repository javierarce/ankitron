// Which segments (subdeck chips) are active. Empty = "All"; otherwise the card
// list is scoped to the union of these exact deck names. Cmd/Ctrl+click toggles
// a segment into the set; Shift+click extends a range from the last-clicked
// one; a plain click selects just one (or clears it back to "All").

import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { DeckRename } from "@/lib/deck";

interface UseDeckSegmentsOptions {
  /** The chips, in row order — Shift+click ranges follow it. */
  segmentDecks: string[];
  /**
   * A just-applied deck rename's from→to mapping. When a scoped subdeck is
   * renamed in place, its chip keeps the same position but a new name, so we
   * carry the selection (and the Shift anchor) across rather than dropping it.
   */
  renames?: DeckRename[] | null;
}

export function useDeckSegments({
  segmentDecks,
  renames,
}: UseDeckSegmentsOptions) {
  const [activeSegments, setActiveSegments] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // The last segment clicked, used as the anchor for Shift+click ranges.
  const [lastSegment, setLastSegment] = useState<string | null>(null);

  // Apply a fresh rename mapping once (keyed by its identity) — renaming a
  // scoped subdeck changes the active segment's name, not the selection itself.
  const [appliedRenames, setAppliedRenames] = useState(renames);
  if (renames !== appliedRenames) {
    setAppliedRenames(renames);
    if (renames && renames.length > 0) {
      const map = new Map(renames.map((r) => [r.from, r.to]));
      setActiveSegments((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const seg of prev) {
          const to = map.get(seg);
          if (to) changed = true;
          next.add(to ?? seg);
        }
        return changed ? next : prev;
      });
      setLastSegment((prev) => (prev && map.get(prev)) || prev);
    }
  }

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
