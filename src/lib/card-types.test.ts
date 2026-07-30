import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCardTypeFor } from "./card-types";
import { setDeckPref } from "./deck-prefs";

// Lib tests run in the node environment, which has no localStorage.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("defaultCardTypeFor", () => {
  it("opens on Basic when the deck has no preference", () => {
    expect(defaultCardTypeFor("Spanish")).toBe("Basic");
  });

  it("opens on the deck's preferred type", () => {
    setDeckPref("Spanish", "noteType", "ClozeTyped");
    expect(defaultCardTypeFor("Spanish")).toBe("ClozeTyped");
    // Scoped to that deck only.
    expect(defaultCardTypeFor("German")).toBe("Basic");
  });

  // A value from an older build (or a hand-edited store) must not put the form
  // into a type it can't render.
  it("falls back when the stored type isn't one we can edit", () => {
    setDeckPref("Spanish", "noteType", "ImageOcclusion");
    expect(defaultCardTypeFor("Spanish")).toBe("Basic");
  });
});
