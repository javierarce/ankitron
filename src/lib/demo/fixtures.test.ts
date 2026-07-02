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

  it("derives the deck tree (incl. parents of subdecks) with unique ids", () => {
    const names = DECKS.map((d) => d.name);
    // "Spanish" is authored only via its subdecks' notes, so it must be derived.
    expect(names).toContain("Spanish");
    expect(names).toContain("Spanish::Verbs");
    expect(names).toContain("Programming::JavaScript");
    expect(new Set(DECKS.map((d) => d.id)).size).toBe(DECKS.length);
  });

  it("gives every note a valid scheduling state and non-empty content", () => {
    const valid = new Set(["new", "learn", "review", "done"]);
    expect(NOTES.length).toBeGreaterThan(15);
    for (const n of NOTES) {
      expect(valid.has(n.state)).toBe(true);
      expect(n.front.length).toBeGreaterThan(0);
      expect(Array.isArray(n.tags)).toBe(true);
    }
  });
});
