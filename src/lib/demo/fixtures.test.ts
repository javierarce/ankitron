import { describe, it, expect } from "vitest";
import { isExportedDeck } from "@/lib/import-export";
import { DECKS, NOTES } from "./fixtures";

// The deck files are the demo's content. These tests pin the two properties
// that make the JSON-as-content approach safe: the files are real importable
// decks, and the loader derives a coherent deck tree from them.
const deckFiles = import.meta.glob<{ default: unknown }>("./decks/*.json", {
  eager: true,
});

describe("demo fixtures", () => {
  it("every demo deck file is a real, importable Ankitron deck", () => {
    const entries = Object.entries(deckFiles);
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, mod] of entries) {
      expect(isExportedDeck(mod.default), `${file} is not a valid deck file`).toBe(
        true,
      );
    }
  });

  // Content-agnostic so the demo decks can be swapped freely: assert the shape
  // the loader must produce, not specific deck names.
  it("derives a coherent deck tree with unique ids", () => {
    expect(DECKS.length).toBeGreaterThan(0);
    expect(NOTES.length).toBeGreaterThan(0);
    expect(new Set(DECKS.map((d) => d.id)).size).toBe(DECKS.length);

    const names = new Set(DECKS.map((d) => d.name));
    for (const n of NOTES) {
      // Every note's deck is registered...
      expect(names.has(n.deckName)).toBe(true);
      // ...and every subdeck's ancestor decks are derived (e.g. "A::B" ⇒ "A").
      const parts = n.deckName.split("::");
      for (let i = 1; i < parts.length; i++) {
        expect(names.has(parts.slice(0, i).join("::"))).toBe(true);
      }
    }
  });

  it("gives every note a valid scheduling state and non-empty content", () => {
    const valid = new Set(["new", "learn", "review", "done"]);
    expect(NOTES.length).toBeGreaterThan(0);
    for (const n of NOTES) {
      expect(valid.has(n.state)).toBe(true);
      expect(n.front.length).toBeGreaterThan(0);
      expect(Array.isArray(n.tags)).toBe(true);
    }
  });
});
