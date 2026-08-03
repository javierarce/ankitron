// Plain text with its search-term matches marked, for note list rows.
//
// Rendered as <mark>: the semantic element for text relevant to what the user
// is currently doing, which is exactly a search hit. Its default styling (black
// on yellow, fixed) ignores the theme, so `.search-hit` in globals.css restyles
// it — see there for the tint.

import type { ReactNode } from "react";
import type { MatchRange } from "@/lib/search-highlight";

interface HighlightedTextProps {
  text: string;
  /** Ranges indexing `text`, in order and non-overlapping (see matchRanges). */
  ranges: MatchRange[];
}

export function HighlightedText({ text, ranges }: HighlightedTextProps) {
  // The overwhelmingly common case — no search running, or this line isn't
  // where the note matched — renders as a single text node, same as before.
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const [i, range] of ranges.entries()) {
    if (range.start > pos) parts.push(text.slice(pos, range.start));
    parts.push(
      <mark key={i} className="search-hit">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    pos = range.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
