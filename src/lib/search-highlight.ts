/**
 * Locating a query's terms inside the plain text a note list row shows, so the
 * row can point at what matched.
 *
 * Matching folds both sides (see fold-text) so it agrees with the search filter
 * itself — typing "backerei" highlights "Bäckerei". Everything here is pure and
 * unit-tested; the rendering lives in components/highlighted-text.
 */

import { foldText, foldWithMap } from "./fold-text";
import { charBoundary, truncate } from "./html-text";

/** A half-open `[start, end)` slice of text that a search term matched. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * How far into a line we look for a match. This runs for every visible row on
 * every keystroke, so the cost has to be bounded by something other than the
 * length of a note field — which can run to thousands of characters. A match
 * past this point stays unhighlighted.
 */
const SCAN_LIMIT = 400;

/** Characters of lead-in kept before the match when the window has to shift. */
const LEAD_IN = 24;

/** How far back we look for a word boundary before settling for a mid-word cut. */
const BOUNDARY_LOOKBACK = 12;

/** Every place any of `terms` occurs in `text`, merged and in reading order. */
export function matchRanges(text: string, terms: string[]): MatchRange[] {
  if (terms.length === 0 || text === "") return [];
  const { folded, map } = foldWithMap(text);
  const found: MatchRange[] = [];
  for (const term of terms) {
    const needle = foldText(term);
    if (needle === "") continue;
    // Resuming past the match rather than one character into it means repeats
    // are counted the way a reader would count them: "ana" occurs once in
    // "banana", so "b[ana]na" marks one term, not an overlapped "b[anana]".
    let i = folded.indexOf(needle);
    while (i !== -1) {
      found.push({ start: map[i], end: map[i + needle.length] });
      i = folded.indexOf(needle, i + needle.length);
    }
  }
  return mergeRanges(found);
}

/**
 * Overlapping ranges collapsed into one, so two terms that cover the same
 * characters don't render as nested or duplicated marks.
 */
function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchRange[] = [{ ...sorted[0] }];
  for (const r of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** The ranges overlapping `[from, to)`, clipped to it, in source coordinates. */
function clampRanges(
  ranges: MatchRange[],
  from: number,
  to: number,
): MatchRange[] {
  const out: MatchRange[] = [];
  for (const r of ranges) {
    const start = Math.max(r.start, from);
    const end = Math.min(r.end, to);
    if (start < end) out.push({ start, end });
  }
  return out;
}

/**
 * Nudge `index` back to the start of the word it lands in, so a shifted window
 * opens on a whole word. Gives up after a short look-back rather than rewinding
 * across a long unbroken run.
 */
function wordStart(text: string, index: number): number {
  if (index <= 0) return 0;
  const limit = Math.max(0, index - BOUNDARY_LOOKBACK);
  for (let i = index; i > limit; i--) {
    if (/\s/.test(text[i - 1])) return i;
  }
  return index;
}

/** A row's visible text with the match positions inside it. */
export interface ClippedText {
  text: string;
  /** Ranges indexing `text` (not the source), ready to render. */
  ranges: MatchRange[];
}

/**
 * `text` clipped to `max` characters for a list row, positioned so a match is
 * visible: normally the head of the line, but when the first match sits past
 * the cut, the window slides along to bring it into view behind a leading
 * ellipsis. Without the slide, a search whose hit lives late in a long field
 * highlights nothing and reads as broken.
 */
export function clipToMatch(
  text: string,
  max: number,
  terms: string[],
): ClippedText {
  if (terms.length === 0) return { text: truncate(text, max), ranges: [] };
  const ranges = matchRanges(
    text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text,
    terms,
  );
  const first = ranges[0];
  if (!first || first.end <= max) {
    return { text: truncate(text, max), ranges: clampRanges(ranges, 0, max) };
  }
  // Both edges are arithmetic offsets, so both get nudged off any surrogate
  // pair they landed inside (the same guard truncate uses for the head window).
  const start = charBoundary(text, wordStart(text, Math.max(0, first.start - LEAD_IN)));
  const end = charBoundary(text, start + max);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return {
    text: head + text.slice(start, end) + tail,
    ranges: clampRanges(ranges, start, end).map((r) => ({
      start: r.start - start + head.length,
      end: r.end - start + head.length,
    })),
  };
}
