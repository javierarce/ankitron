// The curated note types the card form can edit, and which one a deck opens on.
//
// Kept out of the form component so the deck settings UI can offer the same
// list without importing an editor (and so the form file stays components-only,
// which Fast Refresh requires).

import { getDeckPrefs } from "./deck-prefs";

export type CardType = "Basic" | "BasicReversed" | "Cloze" | "ClozeTyped";

export const CARD_TYPE_OPTIONS: { value: CardType; label: string }[] = [
  { value: "Basic", label: "Basic" },
  { value: "BasicReversed", label: "Basic (and reversed)" },
  { value: "Cloze", label: "Cloze" },
  { value: "ClozeTyped", label: "Cloze (typed)" },
];

/** What a new note starts as when its deck has no preference of its own. */
export const DEFAULT_CARD_TYPE: CardType = "Basic";

/**
 * The type new notes in this deck should open on. Validated against the options
 * above, so a preference left behind by an older build (or a hand-edited store)
 * falls back rather than putting the form into a type it can't render.
 */
export function defaultCardTypeFor(deckName: string): CardType {
  const saved = getDeckPrefs(deckName).noteType;
  return CARD_TYPE_OPTIONS.find((o) => o.value === saved)?.value ?? DEFAULT_CARD_TYPE;
}
