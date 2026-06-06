import { describe, it, expect, vi } from "vitest";
import {
  buildExport,
  fetchCardDecksByNoteId,
  flattenFields,
  importDeck,
  isExportedDeck,
  resolveTargetDeck,
  sanitizeFilename,
  type ExportedDeck,
  type ImportDeps,
} from "./import-export";
import { CLOZE_TYPED_MODEL } from "./cloze-typed-model";
import { Note } from "./types";

describe("flattenFields", () => {
  it("flattens NoteField values into a string map", () => {
    expect(
      flattenFields({
        Front: { value: "hi", order: 0 },
        Back: { value: "bye", order: 1 },
      }),
    ).toEqual({ Front: "hi", Back: "bye" });
  });

  it("handles an empty fields object", () => {
    expect(flattenFields({})).toEqual({});
  });

  it("falls back to empty string when value is missing", () => {
    // AnkiConnect occasionally returns sparse field objects.
    const sparse = {
      Front: { value: "hi", order: 0 },
      Back: undefined as unknown as { value: string; order: number },
    };
    expect(flattenFields(sparse)).toEqual({ Front: "hi", Back: "" });
  });
});

describe("sanitizeFilename", () => {
  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFilename('foo/bar:baz*?"<>|\\')).toBe("foo_bar_baz_");
  });

  it("falls back to 'deck' for empty/whitespace/all-unsafe input", () => {
    expect(sanitizeFilename("")).toBe("deck");
    expect(sanitizeFilename("   ")).toBe("deck");
    expect(sanitizeFilename("///")).toBe("deck");
  });

  it("preserves safe names", () => {
    expect(sanitizeFilename("My Deck")).toBe("My Deck");
    expect(sanitizeFilename("Studie-2024_v2")).toBe("Studie-2024_v2");
  });
});

describe("buildExport", () => {
  it("produces a round-trippable shape with frozen timestamp", () => {
    const notes: Note[] = [
      {
        noteId: 1,
        modelName: "Basic",
        fields: {
          Front: { value: "Q", order: 0 },
          Back: { value: "A", order: 1 },
        },
        tags: ["x"],
      },
      {
        noteId: 2,
        modelName: "Cloze",
        fields: {
          Text: { value: "{{c1::cap}}", order: 0 },
          "Back Extra": { value: "", order: 1 },
        },
        tags: [],
      },
      {
        noteId: 3,
        modelName: CLOZE_TYPED_MODEL,
        fields: {
          Text: { value: "{{c1::typed}}", order: 0 },
          "Back Extra": { value: "", order: 1 },
        },
        tags: [],
      },
    ];
    expect(
      buildExport("D", notes, new Date("2026-01-01T00:00:00Z")),
    ).toEqual({
      deckName: "D",
      exportedAt: "2026-01-01T00:00:00.000Z",
      notes: [
        {
          noteId: 1,
          modelName: "Basic",
          fields: { Front: "Q", Back: "A" },
          tags: ["x"],
        },
        {
          noteId: 2,
          modelName: "Cloze",
          fields: { Text: "{{c1::cap}}", "Back Extra": "" },
          tags: [],
        },
        {
          noteId: 3,
          modelName: CLOZE_TYPED_MODEL,
          fields: { Text: "{{c1::typed}}", "Back Extra": "" },
          tags: [],
        },
      ],
    });
  });

  it("stamps each note's deck when a deck map is provided", () => {
    const notes: Note[] = [
      {
        noteId: 1,
        modelName: "Basic",
        fields: { Front: { value: "Q", order: 0 } },
        tags: [],
      },
      {
        noteId: 2,
        modelName: "Basic",
        fields: { Front: { value: "Q2", order: 0 } },
        tags: [],
      },
    ];
    const cardDecksByNoteId = new Map<number, string[]>([
      [1, ["Spanish::Verbs"]],
    ]);
    const out = buildExport(
      "Spanish",
      notes,
      new Date("2026-01-01T00:00:00Z"),
      cardDecksByNoteId,
    );
    expect(out.notes[0].deck).toBe("Spanish::Verbs");
    // Single-deck note: no per-card list needed.
    expect(out.notes[0].cardDecks).toBeUndefined();
    // Notes absent from the map carry no deck (fall back to root on import).
    expect(out.notes[1].deck).toBeUndefined();
  });

  it("records cardDecks only when a note's cards span multiple decks", () => {
    const notes: Note[] = [
      {
        noteId: 1,
        modelName: "Basic (and reversed card)",
        fields: { Front: { value: "Q", order: 0 } },
        tags: [],
      },
    ];
    const cardDecksByNoteId = new Map<number, string[]>([
      [1, ["Spanish::Verbs", "Spanish::Review"]],
    ]);
    const out = buildExport(
      "Spanish",
      notes,
      new Date("2026-01-01T00:00:00Z"),
      cardDecksByNoteId,
    );
    expect(out.notes[0].deck).toBe("Spanish::Verbs");
    expect(out.notes[0].cardDecks).toEqual([
      "Spanish::Verbs",
      "Spanish::Review",
    ]);
  });

  it("round-trips through JSON and back through isExportedDeck", () => {
    const notes: Note[] = [
      {
        noteId: 42,
        modelName: "Basic",
        fields: {
          Front: { value: "hi", order: 0 },
          Back: { value: "bye", order: 1 },
        },
        tags: ["t1"],
      },
    ];
    const exported = buildExport("D", notes);
    const reparsed = JSON.parse(JSON.stringify(exported));
    expect(isExportedDeck(reparsed)).toBe(true);
  });
});

describe("isExportedDeck", () => {
  const valid: ExportedDeck = {
    deckName: "D",
    exportedAt: "2026-01-01",
    notes: [{ modelName: "Basic", fields: { Front: "a" }, tags: [] }],
  };

  it("accepts a valid export", () => {
    expect(isExportedDeck(valid)).toBe(true);
  });

  it("accepts an export with no notes", () => {
    expect(isExportedDeck({ ...valid, notes: [] })).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isExportedDeck(null)).toBe(false);
    expect(isExportedDeck("x")).toBe(false);
    expect(isExportedDeck(42)).toBe(false);
  });

  it("rejects missing deckName or notes", () => {
    expect(isExportedDeck({ notes: [] })).toBe(false);
    expect(isExportedDeck({ deckName: "D" })).toBe(false);
  });

  it("rejects malformed note entries", () => {
    expect(
      isExportedDeck({ deckName: "D", notes: [{ modelName: 1 }] }),
    ).toBe(false);
    expect(
      isExportedDeck({
        deckName: "D",
        notes: [{ modelName: "B", fields: null, tags: [] }],
      }),
    ).toBe(false);
    expect(
      isExportedDeck({
        deckName: "D",
        notes: [{ modelName: "B", fields: {}, tags: "x" }],
      }),
    ).toBe(false);
  });
});

describe("resolveTargetDeck", () => {
  it("maps a subdeck onto the target, preserving the relative path", () => {
    expect(resolveTargetDeck("Español", "Spanish", "Spanish::Verbs")).toBe(
      "Español::Verbs",
    );
    expect(
      resolveTargetDeck("Español", "Spanish", "Spanish::Verbs::Irregular"),
    ).toBe("Español::Verbs::Irregular");
  });

  it("maps the root note onto the target root", () => {
    expect(resolveTargetDeck("Español", "Spanish", "Spanish")).toBe("Español");
    expect(resolveTargetDeck("Español", "Spanish", undefined)).toBe("Español");
  });

  it("falls back to the root for decks outside the exported subtree", () => {
    expect(resolveTargetDeck("Español", "Spanish", "French::Verbs")).toBe(
      "Español",
    );
    // A sibling whose name merely shares a prefix is not a subdeck.
    expect(resolveTargetDeck("Español", "Spanish", "Spanishish")).toBe(
      "Español",
    );
  });
});

describe("fetchCardDecksByNoteId", () => {
  it("maps notes to the decks of all their cards, in card order", async () => {
    const notes: Note[] = [
      {
        noteId: 1,
        modelName: "Basic",
        fields: {},
        tags: [],
        cards: [11],
      },
      {
        // A note whose two cards live in different decks.
        noteId: 2,
        modelName: "Basic (and reversed card)",
        fields: {},
        tags: [],
        cards: [22, 23],
      },
      // No cards → omitted from the map.
      { noteId: 3, modelName: "Basic", fields: {}, tags: [] },
    ];
    const ankiFetch = vi.fn(async (action: string) => {
      if (action === "cardsInfo") {
        return [
          { cardId: 11, deckName: "Spanish" },
          { cardId: 22, deckName: "Spanish::Verbs" },
          { cardId: 23, deckName: "Spanish::Review" },
        ];
      }
      return null;
    });

    const map = await fetchCardDecksByNoteId(notes, ankiFetch as never);
    expect(map.get(1)).toEqual(["Spanish"]);
    expect(map.get(2)).toEqual(["Spanish::Verbs", "Spanish::Review"]);
    expect(map.has(3)).toBe(false);
    // All card IDs across all notes go in one cardsInfo call.
    expect(ankiFetch).toHaveBeenCalledWith("cardsInfo", {
      cards: [11, 22, 23],
    });
  });

  it("makes no card lookup when no notes have cards", async () => {
    const ankiFetch = vi.fn(async () => null);
    const map = await fetchCardDecksByNoteId(
      [{ noteId: 1, modelName: "Basic", fields: {}, tags: [] }],
      ankiFetch as never,
    );
    expect(map.size).toBe(0);
    expect(ankiFetch).not.toHaveBeenCalled();
  });
});

function makeDeps(
  handler?: (action: string, params?: Record<string, unknown>) => unknown,
): ImportDeps & {
  ankiFetch: ReturnType<typeof vi.fn>;
  ensureClozeTypedModel: ReturnType<typeof vi.fn>;
} {
  const ankiFetch = vi.fn(
    async (action: string, params?: Record<string, unknown>) =>
      handler ? handler(action, params) : null,
  );
  const ensureClozeTypedModel = vi.fn(async () => {});
  return { ankiFetch, ensureClozeTypedModel } as never;
}

describe("importDeck", () => {
  it("adds a new note when noteId is missing", async () => {
    const deps = makeDeps((action) => (action === "addNote" ? 999 : null));
    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "a", Back: "b" }, tags: ["t"] },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toEqual({ updated: 0, added: 1, skipped: 0, errors: [] });
    expect(deps.ankiFetch).toHaveBeenCalledWith("addNote", {
      note: {
        deckName: "D",
        modelName: "Basic",
        fields: { Front: "a", Back: "b" },
        tags: ["t"],
        options: { duplicateScope: "deck" },
      },
    });
  });

  it("scopes duplicate detection to the target deck", async () => {
    const deps = makeDeps((action) => (action === "addNote" ? 1 : null));
    const parsed: ExportedDeck = {
      deckName: "Source",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "a" }, tags: [] },
      ],
    };
    await importDeck("Target", parsed, deps, { addOnly: true });
    const addCall = deps.ankiFetch.mock.calls.find((c) => c[0] === "addNote");
    expect(
      (addCall![1] as { note: { options?: { duplicateScope?: string } } }).note
        .options?.duplicateScope,
    ).toBe("deck");
  });

  it("counts skipped when addNote returns null (duplicate)", async () => {
    const deps = makeDeps(() => null);
    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "a", Back: "b" }, tags: [] },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ added: 0, skipped: 1, errors: [] });
  });

  it("ensures the Cloze (typed) model before adding such notes", async () => {
    const deps = makeDeps((action) => (action === "addNote" ? 1 : null));
    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          modelName: CLOZE_TYPED_MODEL,
          fields: { Text: "{{c1::x}}", "Back Extra": "" },
          tags: [],
        },
      ],
    };
    await importDeck("D", parsed, deps);
    expect(deps.ensureClozeTypedModel).toHaveBeenCalledOnce();
  });

  it("does not ensure the Cloze (typed) model for Basic notes", async () => {
    const deps = makeDeps((action) => (action === "addNote" ? 1 : null));
    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "a", Back: "b" }, tags: [] },
      ],
    };
    await importDeck("D", parsed, deps);
    expect(deps.ensureClozeTypedModel).not.toHaveBeenCalled();
  });

  it("updates an existing note (matched by noteId) and merges its tags", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo") {
        return [
          {
            noteId: 5,
            modelName: "Basic",
            fields: {
              Front: { value: "old-q", order: 0 },
              Back: { value: "old-a", order: 1 },
            },
            tags: ["old1", "old2"],
          },
        ];
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 5,
          modelName: "Basic",
          fields: { Front: "new-q", Back: "new-a" },
          tags: ["new1"],
        },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ updated: 1, added: 0, skipped: 0 });

    expect(deps.ankiFetch).toHaveBeenCalledWith("updateNoteFields", {
      note: { id: 5, fields: { Front: "new-q", Back: "new-a" } },
    });
    // Existing tags are preserved; only the genuinely new tag is added.
    expect(deps.ankiFetch).toHaveBeenCalledWith("addTags", {
      notes: [5],
      tags: "new1",
    });
    const calls = deps.ankiFetch.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("removeTags");
  });

  it("preserves Anki-managed tags (e.g. leech) on re-import", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo") {
        return [{ noteId: 5, modelName: "Basic", fields: {}, tags: ["leech"] }];
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 5,
          modelName: "Basic",
          fields: { Front: "q", Back: "a" },
          tags: ["vocab"],
        },
      ],
    };
    await importDeck("D", parsed, deps);
    // `leech` is never removed; `vocab` is added alongside it.
    expect(deps.ankiFetch).toHaveBeenCalledWith("addTags", {
      notes: [5],
      tags: "vocab",
    });
    const calls = deps.ankiFetch.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("removeTags");
  });

  it("does not re-add tags that already exist on the note", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo")
        return [{ noteId: 5, modelName: "Basic", fields: {}, tags: ["t"] }];
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { noteId: 5, modelName: "Basic", fields: { Front: "q" }, tags: ["t"] },
      ],
    };
    await importDeck("D", parsed, deps);
    const calls = deps.ankiFetch.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("addTags");
    expect(calls).not.toContain("removeTags");
  });

  it("skips overwriting a note edited in Anki since the export (newer mod)", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo") {
        return [
          { noteId: 5, modelName: "Basic", fields: {}, tags: [], mod: 2000 },
        ];
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 5,
          modelName: "Basic",
          fields: { Front: "stale" },
          tags: ["stale-tag"],
          mod: 1000, // exported before the live note's last edit
        },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ updated: 0, added: 0, skipped: 1 });
    const calls = deps.ankiFetch.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("updateNoteFields");
    expect(calls).not.toContain("addTags");
  });

  it("overwrites when the export is newer than (or same age as) the live note", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo") {
        return [
          { noteId: 5, modelName: "Basic", fields: {}, tags: [], mod: 1000 },
        ];
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 5,
          modelName: "Basic",
          fields: { Front: "fresh" },
          tags: [],
          mod: 2000,
        },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ updated: 1, skipped: 0 });
    expect(deps.ankiFetch).toHaveBeenCalledWith("updateNoteFields", {
      note: { id: 5, fields: { Front: "fresh" } },
    });
  });

  it("skips addTags when the imported note has no tags", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo")
        return [{ noteId: 5, modelName: "Basic", fields: {}, tags: [] }];
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 5,
          modelName: "Basic",
          fields: { Front: "q", Back: "a" },
          tags: [],
        },
      ],
    };
    await importDeck("D", parsed, deps);
    const calls = deps.ankiFetch.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("addTags");
  });

  it("falls back to addNote when noteId is not found in Anki", async () => {
    const deps = makeDeps((action) => {
      if (action === "notesInfo") return [{}]; // missing notes come back empty
      if (action === "addNote") return 42;
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        {
          noteId: 999,
          modelName: "Basic",
          fields: { Front: "a", Back: "b" },
          tags: [],
        },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ updated: 0, added: 1 });
  });

  it("treats Anki's duplicate-detection error as skipped (not an error)", async () => {
    let call = 0;
    const deps = makeDeps((action) => {
      if (action === "addNote") {
        call += 1;
        if (call === 1) {
          throw new Error("cannot create note because it is a duplicate");
        }
        return 7;
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "dup", Back: "x" }, tags: [] },
        { modelName: "Basic", fields: { Front: "new", Back: "y" }, tags: [] },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({
      added: 1,
      skipped: 1,
      errors: [],
    });
  });

  it("collects per-note errors and continues with the rest", async () => {
    let addCalls = 0;
    const deps = makeDeps((action) => {
      if (action === "addNote") {
        addCalls += 1;
        if (addCalls === 1) throw new Error("boom");
        return 7;
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "a" }, tags: [] },
        { modelName: "Basic", fields: { Front: "b" }, tags: [] },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result.added).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("boom");
  });

  it("with addOnly=true, treats every note as an add (even when noteId exists)", async () => {
    const deps = makeDeps((action) => {
      if (action === "addNote") return 100;
      // notesInfo should not be reached for the existence check
      if (action === "notesInfo") {
        throw new Error("addOnly should skip the existence check");
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "Source",
      exportedAt: "x",
      notes: [
        { noteId: 1, modelName: "Basic", fields: { Front: "a" }, tags: [] },
        { noteId: 2, modelName: "Basic", fields: { Front: "b" }, tags: [] },
        { modelName: "Basic", fields: { Front: "c" }, tags: [] },
      ],
    };
    const result = await importDeck("Target", parsed, deps, { addOnly: true });
    expect(result).toMatchObject({ updated: 0, added: 3, skipped: 0 });

    const addCalls = deps.ankiFetch.mock.calls.filter(
      (c) => c[0] === "addNote",
    );
    expect(addCalls).toHaveLength(3);
    // Cards land in the target deck, not the source deck.
    const targetedDecks = addCalls.map(
      (c) => (c[1] as { note: { deckName: string } }).note.deckName,
    );
    expect(targetedDecks).toEqual(["Target", "Target", "Target"]);
  });

  it("recreates subdecks and places each note in its mapped deck", async () => {
    const created: string[] = [];
    const deps = makeDeps((action, params) => {
      if (action === "createDeck") {
        created.push((params as { deck: string }).deck);
        return 1;
      }
      if (action === "addNote") return Math.floor(Math.random() * 1000) + 10;
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "Spanish",
      exportedAt: "x",
      notes: [
        { modelName: "Basic", fields: { Front: "root" }, tags: [], deck: "Spanish" },
        {
          modelName: "Basic",
          fields: { Front: "verb" },
          tags: [],
          deck: "Spanish::Verbs",
        },
        {
          modelName: "Basic",
          fields: { Front: "irr" },
          tags: [],
          deck: "Spanish::Verbs::Irregular",
        },
      ],
    };

    // Round-trip into the same deck name.
    const result = await importDeck("Spanish", parsed, deps);
    expect(result).toMatchObject({ added: 3, errors: [] });

    // Subdecks created (root is left to the caller / already exists).
    expect(created).toEqual(
      expect.arrayContaining(["Spanish::Verbs", "Spanish::Verbs::Irregular"]),
    );
    expect(created).not.toContain("Spanish");

    const addCalls = deps.ankiFetch.mock.calls.filter((c) => c[0] === "addNote");
    const decks = addCalls.map(
      (c) => (c[1] as { note: { deckName: string } }).note.deckName,
    );
    expect(decks).toEqual([
      "Spanish",
      "Spanish::Verbs",
      "Spanish::Verbs::Irregular",
    ]);
  });

  it("files each card of a multi-deck note into its own deck after adding", async () => {
    const changeDeckCalls: Array<{ cards: number[]; deck: string }> = [];
    const deps = makeDeps((action, params) => {
      if (action === "addNote") return 500;
      if (action === "notesInfo") {
        // The freshly added note exposes its two card IDs in ordinal order.
        return [{ noteId: 500, modelName: "Basic", fields: {}, tags: [], cards: [70, 71] }];
      }
      if (action === "changeDeck") {
        changeDeckCalls.push(params as { cards: number[]; deck: string });
        return null;
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "Spanish",
      exportedAt: "x",
      notes: [
        {
          modelName: "Basic (and reversed card)",
          fields: { Front: "a", Back: "b" },
          tags: [],
          deck: "Spanish::Verbs",
          cardDecks: ["Spanish::Verbs", "Spanish::Review"],
        },
      ],
    };

    const result = await importDeck("Spanish", parsed, deps);
    expect(result).toMatchObject({ added: 1, errors: [] });

    // First card stays in the primary deck (addNote already placed it there);
    // only the second card is moved.
    expect(changeDeckCalls).toEqual([
      { cards: [71], deck: "Spanish::Review" },
    ]);
    // Both card decks were pre-created.
    expect(deps.ankiFetch).toHaveBeenCalledWith("createDeck", {
      deck: "Spanish::Verbs",
    });
    expect(deps.ankiFetch).toHaveBeenCalledWith("createDeck", {
      deck: "Spanish::Review",
    });
  });

  it("remaps subdecks under a new target root on a cross-deck import", async () => {
    const deps = makeDeps((action) => (action === "addNote" ? 1 : null));
    const parsed: ExportedDeck = {
      deckName: "Spanish",
      exportedAt: "x",
      notes: [
        {
          modelName: "Basic",
          fields: { Front: "verb" },
          tags: [],
          deck: "Spanish::Verbs",
        },
      ],
    };

    await importDeck("Español", parsed, deps, { addOnly: true });

    const addCall = deps.ankiFetch.mock.calls.find((c) => c[0] === "addNote");
    expect(
      (addCall![1] as { note: { deckName: string } }).note.deckName,
    ).toBe("Español::Verbs");
    expect(deps.ankiFetch).toHaveBeenCalledWith("createDeck", {
      deck: "Español::Verbs",
    });
  });

  it("returns zeros and makes no Anki calls for an empty notes array", async () => {
    const deps = makeDeps(() => {
      throw new Error("should not be called");
    });
    const parsed: ExportedDeck = { deckName: "D", exportedAt: "x", notes: [] };
    const result = await importDeck("D", parsed, deps);
    expect(result).toEqual({ updated: 0, added: 0, skipped: 0, errors: [] });
    expect(deps.ankiFetch).not.toHaveBeenCalled();
  });

  it("handles a mixed batch: some noteIds present-and-existing, some missing, some absent", async () => {
    // File has three notes:
    //   - noteId 1: exists in Anki → update
    //   - noteId 2: not in Anki    → add
    //   - no noteId               → add
    const deps = makeDeps((action, params) => {
      if (action === "notesInfo") {
        const ids = (params as { notes: number[] }).notes;
        // Batched existence check: 1 exists, 2 doesn't (empty object).
        if (ids.length === 2 && ids[0] === 1 && ids[1] === 2) {
          return [
            { noteId: 1, modelName: "Basic", fields: {}, tags: [] },
            {},
          ];
        }
        // Per-note tag fetch for the update path.
        return [{ noteId: 1, modelName: "Basic", fields: {}, tags: [] }];
      }
      if (action === "addNote") return Math.floor(Math.random() * 1000) + 10;
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { noteId: 1, modelName: "Basic", fields: { Front: "a" }, tags: [] },
        { noteId: 2, modelName: "Basic", fields: { Front: "b" }, tags: [] },
        { modelName: "Basic", fields: { Front: "c" }, tags: [] },
      ],
    };
    const result = await importDeck("D", parsed, deps);
    expect(result).toMatchObject({ updated: 1, added: 2, skipped: 0, errors: [] });

    // The existence-check call carries only the IDs that were in the file.
    const notesInfoCalls = deps.ankiFetch.mock.calls.filter(
      (c) => c[0] === "notesInfo",
    );
    expect(notesInfoCalls[0][1]).toEqual({ notes: [1, 2] });
  });

  it("batches the existence check via a single notesInfo call", async () => {
    const deps = makeDeps((action, params) => {
      if (action === "notesInfo") {
        const ids = (params as { notes: number[] }).notes;
        // Both ids exist
        return ids.map((id) => ({
          noteId: id,
          modelName: "Basic",
          fields: {},
          tags: [],
        }));
      }
      return null;
    });

    const parsed: ExportedDeck = {
      deckName: "D",
      exportedAt: "x",
      notes: [
        { noteId: 1, modelName: "Basic", fields: { Front: "a" }, tags: [] },
        { noteId: 2, modelName: "Basic", fields: { Front: "b" }, tags: [] },
      ],
    };
    await importDeck("D", parsed, deps);

    const notesInfoCalls = deps.ankiFetch.mock.calls.filter(
      (c) => c[0] === "notesInfo",
    );
    // 1 batched existence check + 1 per-note tag fetch (2 notes) = 3
    expect(notesInfoCalls[0][1]).toEqual({ notes: [1, 2] });
    expect(notesInfoCalls).toHaveLength(3);
  });
});
