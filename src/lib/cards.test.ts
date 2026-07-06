import { describe, it, expect, vi } from "vitest";
import { areSuspended, setSuspended } from "./cards";
import { mockAnki } from "./demo/mock-anki";

// Run the typed layer against the demo mock, so setSuspended's suspend /
// unsuspend split is checked against the same simulator the demo build uses
// (which is also what guards the mock's "unsuspend" case from regressing).
vi.mock("./anki-fetch", () => ({
  ankiFetch: (action: string, params?: Record<string, unknown>) =>
    import("./demo/mock-anki").then(({ mockAnki }) => mockAnki(action, params)),
}));

// The mock derives cardId from noteId with a fixed offset (see mock-anki.ts).
const CARD_OFFSET = 100_000;

describe("setSuspended", () => {
  it("suspends and unsuspends cards, round-tripping through areSuspended", async () => {
    const noteId = (await mockAnki("addNote", {
      note: {
        deckName: "SuspendTest",
        fields: { Front: "f", Back: "b" },
        tags: [],
      },
    })) as number;
    const cardId = CARD_OFFSET + noteId;

    await setSuspended([cardId], true);
    expect(await areSuspended([cardId])).toEqual([true]);

    await setSuspended([cardId], false);
    expect(await areSuspended([cardId])).toEqual([false]);
  });
});
