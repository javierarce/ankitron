/**
 * True when a card's home deck falls within the deck being studied — the same
 * deck or one of its subdecks. Anki uses "::" as the hierarchy separator, so a
 * session for "Spanish" includes "Spanish::Verbs" but not "French", a parent
 * like "Spanish"'s own parent, or a similarly-named deck such as "Spanish 2".
 */
export function isCardInDeck(cardDeck: string, studyDeck: string): boolean {
  return cardDeck === studyDeck || isDescendantDeck(cardDeck, studyDeck);
}

/** True when `deck` sits strictly below `ancestor` in the hierarchy — a
 * subdeck at any depth, never the deck itself. */
export function isDescendantDeck(deck: string, ancestor: string): boolean {
  return deck.startsWith(ancestor + "::");
}

/** The decks in `allDeckNames` nested under `deck` (at any depth), in the
 * order given. */
export function subdecksOf(allDeckNames: string[], deck: string): string[] {
  return allDeckNames.filter((d) => isDescendantDeck(d, deck));
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

/** Anki's built-in deck. Special-cased by name (Anki has no isDefault flag). */
export function isDefaultDeck(name: string): boolean {
  return name === "Default";
}

/**
 * Whether "delete" does anything for a deck. Anki never removes the Default deck
 * itself — deleting it only clears its notes — so an empty Default deck has
 * nothing to act on and the delete affordance should be disabled. A note count
 * of undefined means "not loaded yet"; treat that as deletable to avoid
 * flickering the control off before the count arrives.
 */
export function canDeleteDeck(
  name: string,
  noteCount: number | undefined,
): boolean {
  return !(isDefaultDeck(name) && noteCount === 0);
}

/**
 * The confirmation wording for deleting a deck. Centralised so every entry point
 * (the decks list, a deck's Danger Zone, …) warns with the same human-readable
 * path and the same note/subdeck counts rather than drifting into bespoke copy.
 */
export function deckDeleteMessage(
  name: string,
  noteCount: number,
  subdeckCount: number,
): string {
  const notes = `${noteCount} ${noteCount === 1 ? "note" : "notes"}`;
  // Anki can't delete the Default deck itself — it stays and is only emptied —
  // so warn about the notes being removed rather than the deck being deleted.
  if (isDefaultDeck(name)) {
    // An empty Default deck has nothing to act on. The delete control is
    // normally disabled in this state, but the counts can still be unloaded when
    // the dialog opens, so word it sensibly rather than "all 0 of its notes".
    if (noteCount === 0) {
      return "The Default deck cannot be deleted, and it has no notes to remove.";
    }
    const removed =
      noteCount === 1 ? "its 1 note" : `all ${noteCount} of its notes`;
    return `The Default deck cannot be deleted, but this will permanently remove ${removed}. This action cannot be undone.`;
  }
  const subdecks =
    subdeckCount > 0
      ? ` and its ${subdeckCount} ${subdeckCount === 1 ? "subdeck" : "subdecks"}`
      : "";
  return `Delete “${formatDeckPath(name)}”${subdecks}? This permanently removes ${notes} and cannot be undone.`;
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

/**
 * The minimal set of decks whose subtrees cover `selected`, dropping any deck
 * that is a descendant of another selected deck. Studying a deck already pulls
 * in its whole subtree (Anki reviews descendants too), so keeping a child
 * alongside its ancestor would study those cards twice and double-count the
 * queue. The result is a set of disjoint subtrees, sorted as a tree.
 */
export function coveringDecks(selected: string[]): string[] {
  const unique = [...new Set(selected)];
  return unique
    .filter((d) => !unique.some((other) => other !== d && isCardInDeck(d, other)))
    .sort(compareDeckPaths);
}

/** One node of the deck hierarchy: leaf name, full "::" path, and subdecks. */
export interface DeckNode {
  name: string;
  fullName: string;
  children: DeckNode[];
}

/**
 * Build a tree from "::"-separated deck paths. Sorted by compareDeckPaths so
 * parents precede children and siblings are alphabetical; missing ancestors are
 * created implicitly (Anki normally lists them, but stay robust if not).
 */
export function buildDeckTree(decks: string[]): DeckNode[] {
  const roots: DeckNode[] = [];
  const byFull = new Map<string, DeckNode>();
  for (const deck of [...decks].sort(compareDeckPaths)) {
    const parts = deck.split("::");
    let parentFull = "";
    for (let i = 0; i < parts.length; i++) {
      const fullName = parts.slice(0, i + 1).join("::");
      if (!byFull.has(fullName)) {
        const node: DeckNode = { name: parts[i], fullName, children: [] };
        byFull.set(fullName, node);
        if (i === 0) roots.push(node);
        else byFull.get(parentFull)!.children.push(node);
      }
      parentFull = fullName;
    }
  }
  return roots;
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
