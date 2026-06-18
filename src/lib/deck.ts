/**
 * True when a card's home deck falls within the deck being studied — the same
 * deck or one of its subdecks. Anki uses "::" as the hierarchy separator, so a
 * session for "Spanish" includes "Spanish::Verbs" but not "French", a parent
 * like "Spanish"'s own parent, or a similarly-named deck such as "Spanish 2".
 */
export function isCardInDeck(cardDeck: string, studyDeck: string): boolean {
  return cardDeck === studyDeck || cardDeck.startsWith(studyDeck + "::");
}

/** The deck's own name — the segment after the last "::" (or the whole name). */
export function deckLeaf(name: string): string {
  const i = name.lastIndexOf("::");
  return i === -1 ? name : name.slice(i + 2);
}

/** The parent path — everything before the last "::", or "" for a top-level deck. */
export function deckParent(name: string): string {
  const i = name.lastIndexOf("::");
  return i === -1 ? "" : name.slice(0, i);
}

/** Join a parent path and a leaf into a full deck name ("" parent → top level). */
export function joinDeck(parent: string, leaf: string): string {
  return parent ? `${parent}::${leaf}` : leaf;
}

/** Nesting depth — 0 for a top-level deck, 1 for its subdeck, and so on. */
export function deckDepth(name: string): number {
  return name.split("::").length - 1;
}

/** Render a deck path for humans: "Languages::Deutsch" → "Languages / Deutsch". */
export function formatDeckPath(name: string): string {
  return name.split("::").join(" / ");
}

/**
 * The confirmation wording for deleting a deck. Centralised so every entry point
 * (the decks list, a deck's Danger Zone, …) warns with the same human-readable
 * path and the same card/subdeck counts rather than drifting into bespoke copy.
 */
export function deckDeleteMessage(
  name: string,
  cardCount: number,
  subdeckCount: number,
): string {
  const subdecks =
    subdeckCount > 0
      ? ` and its ${subdeckCount} ${subdeckCount === 1 ? "subdeck" : "subdecks"}`
      : "";
  const cards = `${cardCount} ${cardCount === 1 ? "card" : "cards"}`;
  return `Delete “${formatDeckPath(name)}”${subdecks}? This permanently removes ${cards} and cannot be undone.`;
}

/**
 * Order decks as a tree: each deck immediately precedes its own subdecks, and
 * siblings sort alphabetically. Comparing whole names alphabetically gets this
 * wrong (e.g. "Spanish 2" would fall between "Spanish" and "Spanish::Verbs"),
 * so compare segment by segment instead.
 */
export function compareDeckPaths(a: string, b: string): number {
  const as = a.split("::");
  const bs = b.split("::");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const c = as[i].localeCompare(bs[i]);
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

/** A single deck's old → new name as part of a rename. */
export interface DeckRename {
  from: string;
  to: string;
}

/**
 * Build the from → to mapping for renaming `oldName` to `newName`. Anki keys
 * decks by their "::" path, so renaming a deck means renaming the deck *and*
 * every subdeck beneath it (e.g. renaming "Spanish" must also carry
 * "Spanish::Verbs" → "<new>::Verbs"). Returns one entry per affected deck.
 */
export function planDeckRename(
  oldName: string,
  newName: string,
  allDecks: string[],
): DeckRename[] {
  return allDecks
    .filter((d) => isCardInDeck(d, oldName))
    .map((d) => ({ from: d, to: newName + d.slice(oldName.length) }));
}

type AnkiFetch = <T = unknown>(
  action: string,
  params?: Record<string, unknown>,
) => Promise<T>;

/**
 * Rename a deck (and its subdecks). AnkiConnect has no renameDeck action and a
 * deck's identity is its "::" name path, so we emulate it: recreate each deck
 * under the new path, move its cards over, carry its options group across, then
 * delete the originals without their cards. Returns the from → to mapping so the
 * caller can migrate any per-deck client state (e.g. language settings).
 */
export async function renameDeck(
  oldName: string,
  newName: string,
  ankiFetch: AnkiFetch,
): Promise<DeckRename[]> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Enter a new deck name.");
  // Anki matches deck names case-insensitively, so all comparisons below do too.
  const lowerOld = oldName.toLowerCase();
  const lowerNew = trimmed.toLowerCase();
  // A pure case change can't be done through this create/move/delete emulation:
  // createDeck would return the existing deck (Anki dedupes by lowercased name),
  // and the final delete would then take its cards with it. Treat it as a no-op.
  if (lowerNew === lowerOld) return [];
  // Renaming into one's own subtree would make deleteDecks remove the just-
  // created target, so block it (Anki forbids this too).
  if (lowerNew.startsWith(lowerOld + "::")) {
    throw new Error("A deck can't be moved inside itself.");
  }

  const namesAndIds = await ankiFetch<Record<string, number>>("deckNamesAndIds");
  const allDecks = Object.keys(namesAndIds);
  if (!allDecks.includes(oldName)) {
    throw new Error(`Deck "${oldName}" no longer exists.`);
  }

  const plan = planDeckRename(oldName, trimmed, allDecks);
  const movingLower = new Set(plan.map((p) => p.from.toLowerCase()));
  for (const { to } of plan) {
    // Merging into an existing deck is almost never intended; refuse rather than
    // silently fold two decks together. Match case-insensitively so "Spanish"
    // can't collide with an existing "spanish".
    const clash = allDecks.find(
      (d) => d.toLowerCase() === to.toLowerCase() && !movingLower.has(d.toLowerCase()),
    );
    if (clash) {
      throw new Error(`A deck named "${clash}" already exists.`);
    }
  }

  for (const { from, to } of plan) {
    let configId: number | undefined;
    try {
      const config = await ankiFetch<{ id?: number }>("getDeckConfig", {
        deck: from,
      });
      configId = config?.id;
    } catch {
      // Fall back to the new deck's default options group.
    }

    await ankiFetch("createDeck", { deck: to });

    // Move only the deck's own cards; each subdeck is moved by its own entry,
    // which preserves the hierarchy instead of flattening it.
    const cardIds = await ankiFetch<number[]>("findCards", {
      query: `deck:"${from}" -deck:"${from}::*"`,
    });
    if (cardIds.length > 0) {
      await ankiFetch("changeDeck", { cards: cardIds, deck: to });
    }

    if (configId != null) {
      await ankiFetch("setDeckConfigId", { decks: [to], configId });
    }
  }

  // Since Anki 2.1.28 deleteDecks always removes the contained cards too, so we
  // can only safely delete the originals once they're empty. Every card was just
  // moved out, but double-check the whole subtree before the destructive delete
  // rather than risk taking a stray card down with it.
  const remaining = await ankiFetch<number[]>("findCards", {
    query: `deck:"${oldName}"`,
  });
  if (remaining.length > 0) {
    throw new Error(
      `Rename incomplete: ${remaining.length} card${
        remaining.length === 1 ? "" : "s"
      } could not be moved out of "${oldName}".`,
    );
  }
  await ankiFetch("deleteDecks", {
    decks: plan.map((p) => p.from),
    cardsToo: true,
  });

  return plan;
}
