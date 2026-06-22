import { describe, it, expect, vi } from "vitest";
import {
  compareDeckPaths,
  coveringDecks,
  deckDeleteMessage,
  deckDepth,
  deckLeaf,
  deckParent,
  formatDeckPath,
  isCardInDeck,
  joinDeck,
  planDeckRename,
  renameDeck,
} from "./deck";

describe("deck path helpers", () => {
  it("splits a top-level deck", () => {
    expect(deckLeaf("Spanish")).toBe("Spanish");
    expect(deckParent("Spanish")).toBe("");
  });

  it("splits a nested deck at the last separator", () => {
    expect(deckLeaf("Spanish::Verbs::Irregular")).toBe("Irregular");
    expect(deckParent("Spanish::Verbs::Irregular")).toBe("Spanish::Verbs");
  });

  it("joins a parent and leaf, treating an empty parent as top level", () => {
    expect(joinDeck("", "Spanish")).toBe("Spanish");
    expect(joinDeck("French", "Verbs")).toBe("French::Verbs");
  });

  it("round-trips leaf/parent back to the original name", () => {
    for (const name of ["Spanish", "Spanish::Verbs", "a::b::c"]) {
      expect(joinDeck(deckParent(name), deckLeaf(name))).toBe(name);
    }
  });

  it("formats a path with ' / ' separators for display", () => {
    expect(formatDeckPath("Spanish")).toBe("Spanish");
    expect(formatDeckPath("Languages::Deutsch")).toBe("Languages / Deutsch");
    expect(formatDeckPath("a::b::c")).toBe("a / b / c");
  });

  it("builds a delete warning with the human path and note/subdeck counts", () => {
    expect(deckDeleteMessage("Languages::Deutsch", 42, 0)).toBe(
      "Delete “Languages / Deutsch”? This permanently removes 42 notes and cannot be undone.",
    );
    // Singular note, and subdecks are called out when present.
    expect(deckDeleteMessage("Spanish", 1, 1)).toBe(
      "Delete “Spanish” and its 1 subdeck? This permanently removes 1 note and cannot be undone.",
    );
    expect(deckDeleteMessage("Spanish", 0, 3)).toBe(
      "Delete “Spanish” and its 3 subdecks? This permanently removes 0 notes and cannot be undone.",
    );
  });

  it("reports nesting depth", () => {
    expect(deckDepth("Spanish")).toBe(0);
    expect(deckDepth("Spanish::Verbs")).toBe(1);
    expect(deckDepth("Spanish::Verbs::Irregular")).toBe(2);
  });

  it("orders decks as a tree, keeping subdecks under their parent", () => {
    const sorted = [
      "Spanish::Verbs",
      "French",
      "Spanish 2",
      "Spanish",
      "Spanish::Nouns",
    ].sort(compareDeckPaths);
    // "Spanish 2" is a separate top-level deck, so it must not slip between
    // "Spanish" and its subdecks.
    expect(sorted).toEqual([
      "French",
      "Spanish",
      "Spanish::Nouns",
      "Spanish::Verbs",
      "Spanish 2",
    ]);
  });
});

describe("isCardInDeck", () => {
  it("matches the exact deck", () => {
    expect(isCardInDeck("Spanish", "Spanish")).toBe(true);
  });

  it("matches a direct subdeck", () => {
    expect(isCardInDeck("Spanish::Verbs", "Spanish")).toBe(true);
  });

  it("matches a deeply nested subdeck", () => {
    expect(isCardInDeck("Spanish::Verbs::Irregular", "Spanish")).toBe(true);
  });

  it("rejects an unrelated deck", () => {
    expect(isCardInDeck("French", "Spanish")).toBe(false);
  });

  it("rejects a sibling whose name shares a prefix but is not a subdeck", () => {
    // "Spanish 2" starts with "Spanish" but is a different top-level deck.
    expect(isCardInDeck("Spanish 2", "Spanish")).toBe(false);
    expect(isCardInDeck("SpanishAdvanced", "Spanish")).toBe(false);
  });

  it("rejects the parent deck when studying a subdeck", () => {
    // Studying "Spanish::Verbs" must not pull in the parent "Spanish".
    expect(isCardInDeck("Spanish", "Spanish::Verbs")).toBe(false);
  });

  it("matches nested levels when studying a subdeck", () => {
    expect(isCardInDeck("Spanish::Verbs::Irregular", "Spanish::Verbs")).toBe(
      true,
    );
  });

  it("rejects a cousin subdeck under a different parent", () => {
    expect(isCardInDeck("French::Verbs", "Spanish")).toBe(false);
  });
});

describe("planDeckRename", () => {
  it("renames the deck and all its subdecks", () => {
    const all = ["Spanish", "Spanish::Verbs", "Spanish::Verbs::Irregular", "French"];
    expect(planDeckRename("Spanish", "Español", all)).toEqual([
      { from: "Spanish", to: "Español" },
      { from: "Spanish::Verbs", to: "Español::Verbs" },
      { from: "Spanish::Verbs::Irregular", to: "Español::Verbs::Irregular" },
    ]);
  });

  it("ignores siblings that merely share a prefix", () => {
    const all = ["Spanish", "Spanish 2", "SpanishAdvanced"];
    expect(planDeckRename("Spanish", "Español", all)).toEqual([
      { from: "Spanish", to: "Español" },
    ]);
  });

  it("can move a deck under a new parent", () => {
    const all = ["Verbs", "Verbs::Irregular"];
    expect(planDeckRename("Verbs", "Spanish::Verbs", all)).toEqual([
      { from: "Verbs", to: "Spanish::Verbs" },
      { from: "Verbs::Irregular", to: "Spanish::Verbs::Irregular" },
    ]);
  });
});

describe("renameDeck", () => {
  /**
   * A small in-memory Anki that actually moves cards and mutates decks, so the
   * tests exercise renameDeck's algorithm end to end. deleteDecks mirrors real
   * Anki ≥ 2.1.28, which rejects cardsToo: false — guarding that regression.
   */
  function fakeAnki(opts: {
    decks: string[];
    cardsByDeck?: Record<string, number[]>;
    configByDeck?: Record<string, number>;
  }) {
    const decks = new Set(opts.decks);
    const cardDeck = new Map<number, string>();
    for (const [deck, ids] of Object.entries(opts.cardsByDeck ?? {})) {
      for (const id of ids) cardDeck.set(id, deck);
    }
    const config = new Map<string, number>(
      Object.entries(opts.configByDeck ?? {}),
    );
    const calls: { action: string; params?: Record<string, unknown> }[] = [];

    const cardsIn = (deck: string, directOnly: boolean) =>
      [...cardDeck.entries()]
        .filter(([, d]) =>
          directOnly ? d === deck : d === deck || d.startsWith(deck + "::"),
        )
        .map(([id]) => id);

    const fetch = vi.fn(
      async (action: string, params?: Record<string, unknown>) => {
        calls.push({ action, params });
        switch (action) {
          case "deckNamesAndIds":
            return Object.fromEntries([...decks].map((d, i) => [d, i + 1]));
          case "getDeckConfig":
            return { id: config.get(params!.deck as string) ?? 1 };
          case "setDeckConfigId":
            for (const d of params!.decks as string[])
              config.set(d, params!.configId as number);
            return null;
          case "createDeck":
            decks.add(params!.deck as string);
            return 1;
          case "findCards": {
            const query = params!.query as string;
            const directOnly = /-deck:"[^"]+::\*"/.test(query);
            const deck = /deck:"([^"]+)"/.exec(query)![1];
            return cardsIn(deck, directOnly);
          }
          case "changeDeck":
            for (const id of params!.cards as number[])
              cardDeck.set(id, params!.deck as string);
            return null;
          case "deleteDecks": {
            if (params!.cardsToo !== true)
              throw new Error("cardsToo must be true since Anki 2.1.28");
            for (const d of params!.decks as string[]) {
              decks.delete(d);
              for (const [id, dk] of cardDeck)
                if (dk === d) cardDeck.delete(id);
            }
            return null;
          }
          default:
            return undefined;
        }
      },
    );
    return {
      fetch: fetch as never,
      calls,
      state: { decks, cardDeck, config },
    };
  }

  it("recreates the deck, moves its cards, carries config, and deletes the original", async () => {
    const { fetch, calls, state } = fakeAnki({
      decks: ["Spanish", "French"],
      cardsByDeck: { Spanish: [1, 2, 3], French: [9] },
      configByDeck: { Spanish: 7 },
    });

    const plan = await renameDeck("Spanish", "Español", fetch);

    expect(plan).toEqual([{ from: "Spanish", to: "Español" }]);
    // Old gone, new exists, the unrelated deck is untouched.
    expect(state.decks.has("Spanish")).toBe(false);
    expect(state.decks.has("Español")).toBe(true);
    expect(state.decks.has("French")).toBe(true);
    // Cards moved (same IDs — not recreated) and the unrelated card stays put.
    expect(state.cardDeck.get(1)).toBe("Español");
    expect(state.cardDeck.get(3)).toBe("Español");
    expect(state.cardDeck.get(9)).toBe("French");
    // Options group carried across.
    expect(state.config.get("Español")).toBe(7);
    // And the delete took the cards too, as modern Anki requires.
    expect(calls).toContainEqual({
      action: "deleteDecks",
      params: { decks: ["Spanish"], cardsToo: true },
    });
  });

  it("carries subdecks along without flattening the hierarchy", async () => {
    const { fetch, state } = fakeAnki({
      decks: ["Spanish", "Spanish::Verbs"],
      cardsByDeck: { Spanish: [1], "Spanish::Verbs": [2] },
    });

    await renameDeck("Spanish", "Español", fetch);

    expect(state.decks.has("Spanish::Verbs")).toBe(false);
    expect(state.decks.has("Español::Verbs")).toBe(true);
    expect(state.cardDeck.get(1)).toBe("Español");
    expect(state.cardDeck.get(2)).toBe("Español::Verbs");
  });

  it("is a no-op when the name is unchanged", async () => {
    const { fetch, calls } = fakeAnki({ decks: ["Spanish"] });
    expect(await renameDeck("Spanish", "Spanish", fetch)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty name without touching Anki", async () => {
    const { fetch, calls } = fakeAnki({ decks: ["Spanish"] });
    await expect(renameDeck("Spanish", "  ", fetch)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("refuses to move a deck inside itself", async () => {
    const { fetch } = fakeAnki({ decks: ["Spanish"] });
    await expect(
      renameDeck("Spanish", "Spanish::Archive", fetch),
    ).rejects.toThrow(/inside itself/);
  });

  it("refuses to merge into an existing deck and changes nothing", async () => {
    const { fetch, calls, state } = fakeAnki({
      decks: ["Spanish", "Español"],
      cardsByDeck: { Spanish: [1] },
    });
    await expect(renameDeck("Spanish", "Español", fetch)).rejects.toThrow(
      /already exists/,
    );
    // Aborted before any mutating call — both decks and the card survive.
    expect(state.decks.has("Spanish")).toBe(true);
    expect(state.cardDeck.get(1)).toBe("Spanish");
    expect(
      calls.some((c) =>
        ["createDeck", "changeDeck", "deleteDecks"].includes(c.action),
      ),
    ).toBe(false);
  });

  it("refuses a target that collides only by letter case", async () => {
    const { fetch, calls } = fakeAnki({
      decks: ["German", "spanish"],
      cardsByDeck: { German: [1] },
    });
    // "Spanish" would be the same deck as the existing "spanish" to Anki.
    await expect(renameDeck("German", "Spanish", fetch)).rejects.toThrow(
      /already exists/,
    );
    expect(
      calls.some((c) =>
        ["createDeck", "changeDeck", "deleteDecks"].includes(c.action),
      ),
    ).toBe(false);
  });

  it("treats a case-only rename of the deck itself as a no-op", async () => {
    const { fetch, calls } = fakeAnki({
      decks: ["Spanish"],
      cardsByDeck: { Spanish: [1] },
    });
    expect(await renameDeck("Spanish", "spanish", fetch)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("blocks moving a deck into its own subtree regardless of case", async () => {
    const { fetch } = fakeAnki({ decks: ["Spanish"] });
    await expect(
      renameDeck("Spanish", "spanish::Archive", fetch),
    ).rejects.toThrow(/inside itself/);
  });
});

describe("coveringDecks", () => {
  it("returns an empty list for no selection", () => {
    expect(coveringDecks([])).toEqual([]);
  });

  it("keeps disjoint subtrees, sorted as a tree", () => {
    expect(
      coveringDecks(["Spanish::Verbs", "Spanish::Nouns"]),
    ).toEqual(["Spanish::Nouns", "Spanish::Verbs"]);
  });

  it("drops a deck that is a descendant of another selected deck", () => {
    expect(
      coveringDecks(["Spanish::Verbs", "Spanish::Verbs::Irregular"]),
    ).toEqual(["Spanish::Verbs"]);
  });

  it("collapses to the root when the parent is selected with its children", () => {
    expect(
      coveringDecks(["Spanish", "Spanish::Verbs", "Spanish::Nouns"]),
    ).toEqual(["Spanish"]);
  });

  it("does not treat a similarly-named sibling as a descendant", () => {
    expect(coveringDecks(["Spanish", "Spanish 2"])).toEqual([
      "Spanish",
      "Spanish 2",
    ]);
  });

  it("dedupes repeated entries", () => {
    expect(coveringDecks(["Spanish::Verbs", "Spanish::Verbs"])).toEqual([
      "Spanish::Verbs",
    ]);
  });
});
