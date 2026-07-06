import { describe, it, expect, vi } from "vitest";
import { mockAnki } from "./demo/mock-anki";
import { resolveNoteForCard } from "./review";

// Run the typed layer against the demo mock: it models the real cardsInfo /
// notesInfo shapes (including the `note`/`noteId` id fields), so the two-hop
// resolution is exercised end to end instead of against hand-rolled fixtures.
vi.mock("./anki-fetch", () => ({
  ankiFetch: (action: string, params?: Record<string, unknown>) =>
    import("./demo/mock-anki").then(({ mockAnki }) => mockAnki(action, params)),
}));

// The mock derives cardId from noteId with a fixed offset (see mock-anki.ts).
const CARD_OFFSET = 100_000;

describe("resolveNoteForCard", () => {
  it("resolves the note behind a card via cardsInfo → notesInfo", async () => {
    const noteId = (await mockAnki("addNote", {
      note: {
        deckName: "ResolveTest",
        fields: { Front: "hola", Back: "hello" },
        tags: ["greetings"],
      },
    })) as number;

    const note = await resolveNoteForCard(CARD_OFFSET + noteId);

    expect(note?.noteId).toBe(noteId);
    expect(note?.fields.Front.value).toBe("hola");
    // The resolved note carries its full card list — what handleSuspend needs
    // to suspend the whole note rather than just the reviewed card.
    expect(note?.cards).toEqual([CARD_OFFSET + noteId]);
  });

  it("returns null for a card that doesn't exist", async () => {
    expect(await resolveNoteForCard(42)).toBeNull();
  });
});
