/**
 * True when a card's home deck falls within the deck being studied — the same
 * deck or one of its subdecks. Anki uses "::" as the hierarchy separator, so a
 * session for "Spanish" includes "Spanish::Verbs" but not "French", a parent
 * like "Spanish"'s own parent, or a similarly-named deck such as "Spanish 2".
 */
export function isCardInDeck(cardDeck: string, studyDeck: string): boolean {
  return cardDeck === studyDeck || cardDeck.startsWith(studyDeck + "::");
}
