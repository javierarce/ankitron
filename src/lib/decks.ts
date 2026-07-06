// Anki deck I/O — the typed calls behind creating, deleting, and inspecting
// decks. Pure deck-name logic (the "::" hierarchy math and the rename/move
// emulation) lives in ./deck, which takes the transport as a parameter so it
// can run against the demo mock in tests; this module binds everything to the
// real transport and is what pages and components import.

import { ankiFetch } from "./anki-fetch";
import { renameDeck as renameDeckVia, type DeckRename } from "./deck";
import type { DeckStats } from "./types";

/** Every deck name in the collection (full "::" paths), in Anki's order. */
export async function fetchDeckNames(): Promise<string[]> {
  return ankiFetch<string[]>("deckNames");
}

/**
 * Create a deck (and any missing "::" ancestors); returns its deck id. Anki
 * dedupes by lowercased name, so creating an existing deck is a harmless
 * no-op that returns the existing deck.
 */
export async function createDeck(name: string): Promise<number> {
  return ankiFetch<number>("createDeck", { deck: name });
}

/**
 * Permanently delete decks and their subtrees. Since Anki 2.1.28 deleteDecks
 * always removes the contained cards too — `cardsToo: true` is AnkiConnect's
 * required acknowledgement of that, so the type demands it rather than
 * letting a caller believe a cards-preserving delete exists.
 */
export async function deleteDecks(
  names: string[],
  options: { cardsToo: true },
): Promise<void> {
  await ankiFetch("deleteDecks", { decks: names, cardsToo: options.cardsToo });
}

/**
 * Raw getDeckStats for `decks`, keyed by deck id with leaf-only names (see
 * DeckStats). Counts are subtree-inclusive. Most callers want the friendlier
 * fetchDueCount/fetchAllDueCounts wrappers in ./anki-fetch instead; this is
 * for call sites that aggregate the stats themselves.
 */
export async function fetchDeckStats(
  decks: string[],
): Promise<Record<string, DeckStats>> {
  return ankiFetch<Record<string, DeckStats>>("getDeckStats", { decks });
}

/**
 * Rename or move a deck (and its subdecks), bound to the real transport.
 * Returns the from → to mapping so callers can record redirects and migrate
 * per-deck client state — see ./deck's renameDeck for the emulation details.
 */
export async function renameDeck(
  oldName: string,
  newName: string,
): Promise<DeckRename[]> {
  return renameDeckVia(oldName, newName, ankiFetch);
}
