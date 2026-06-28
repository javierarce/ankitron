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

/** Lowercase `text` and strip diacritics for substring matching. */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}
