import { describe, it, expect } from "vitest";
import { importDeck, type ExportedDeck } from "@/lib/import-export";
import { ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import { mockAnki } from "./mock-anki";

// Drive the real import code path (importDeck) against the demo mock, the same
// way the demo build wires ankiFetch to it. Guards the two bugs that made
// imports appear broken: a frozen deck list (new decks were invisible) and the
// mock not modelling the actions import performs.
const ankiFetch = <T,>(action: string, params?: Record<string, unknown>) =>
  mockAnki(action, params) as Promise<T>;

describe("demo import", () => {
  it("importing a new deck makes it (and its notes) appear", async () => {
    const parsed: ExportedDeck = {
      deckName: "Norwegian",
      exportedAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { modelName: "Basic", fields: { Front: "danke", Back: "thank you" }, tags: ["greeting"] },
        { modelName: "Basic", fields: { Front: "Hund", Back: "dog" }, tags: [] },
      ],
    };

    // The deck doesn't exist yet.
    expect(await ankiFetch<string[]>("deckNames")).not.toContain("Norwegian");

    // What the import flow does for a new target deck.
    await ankiFetch("createDeck", { deck: "Norwegian" });
    const result = await importDeck(
      "Norwegian",
      parsed,
      { ankiFetch, ensureClozeTypedModel },
      { addOnly: false },
    );

    expect(result.added).toBe(2);
    expect(await ankiFetch<string[]>("deckNames")).toContain("Norwegian");
    const ids = await ankiFetch<number[]>("findNotes", { query: 'deck:"Norwegian"' });
    expect(ids.length).toBe(2);
  });
});
