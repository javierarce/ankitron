/**
 * Diacritic-insensitive text folding for search, so typing "Backerei" finds
 * "Bäckerei" and "cafe" finds "café" — the way Google Docs and most search
 * boxes behave. We decompose accented characters (NFD) and drop the combining
 * accent marks, then lowercase.
 *
 * Use this anywhere a query is matched against text the user typed: deck names,
 * note fields, autocomplete values. Apply it to BOTH the query and the
 * candidate so they fold the same way.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Greek final sigma. Lowercasing a capital sigma yields \u03c2 at the end of a word
 * and \u03c3 anywhere else, so the same letter folds two ways depending on where it
 * sits: "\u039f\u0394\u039f\u03a3" folds to "\u03bf\u03b4\u03bf\u03c2" but its last letter alone folds to "\u03c3". Both
 * spellings are the same letter to anyone searching, so they collapse to one \u2014
 * which also lets a typed "\u03bf\u03b4\u03bf\u03c3" find "\u039f\u0394\u039f\u03a3".
 *
 * This is incidentally what keeps foldWithMap's character-by-character folding
 * identical to folding a whole string: position-dependent lowercasing is the
 * only place the two could disagree, and (Turkish and Lithuanian being
 * locale-specific, which a locale-agnostic toLowerCase never applies) final
 * sigma is its only case.
 */
const FINAL_SIGMA = /\u03c2/g;

/** Lowercase `text` and strip diacritics for substring matching. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(FINAL_SIGMA, "\u03c3");
}

/** A folded string alongside the offsets it came from. */
export interface FoldedText {
  /** The folded text, to match against. */
  folded: string;
  /**
   * Where each folded character came from: `map[i]` is the index in the source
   * string of `folded[i]`, with one extra entry (the source length) at the end
   * so an exclusive end offset maps back too. So a match at `[i, j)` in
   * `folded` covers `source.slice(map[i], map[j])`.
   */
  map: number[];
}

/**
 * Fold `text` while tracking where each folded character came from, so a match
 * found in the folded string can be pointed at in the original.
 *
 * Folding is not length-preserving — NFD splits "é" into two code units and the
 * combining mark is then dropped, so folded offsets drift from source offsets
 * in any accented text. Highlighting with the raw offsets would mark the wrong
 * characters, so we fold character by character and record the source index
 * each piece came from.
 */
export function foldWithMap(text: string): FoldedText {
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    // Step by code point so a surrogate pair (emoji) folds as one character
    // rather than as two halves.
    const char = String.fromCodePoint(text.codePointAt(i) as number);
    const piece = foldText(char);
    for (let k = 0; k < piece.length; k++) map.push(i);
    folded += piece;
    i += char.length;
  }
  map.push(text.length);
  return { folded, map };
}
