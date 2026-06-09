import { describe, it, expect } from "vitest";
import { isCardInDeck } from "./deck";

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
