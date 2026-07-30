import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDeckPrefs, renameDeckPrefs, setDeckPref } from "./deck-prefs";

// Lib tests run in the node environment, which has no localStorage; provide a
// plain in-memory stand-in (same shape the other lib tests use).
let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
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

describe("deck prefs", () => {
  it("stores preferences per deck", () => {
    setDeckPref("Spanish", "noteType", "Cloze");
    setDeckPref("German", "ttsVoiceId", "voice-de");

    expect(getDeckPrefs("Spanish")).toEqual({ noteType: "Cloze" });
    expect(getDeckPrefs("German")).toEqual({ ttsVoiceId: "voice-de" });
    // A deck that was never configured reads as empty, not undefined.
    expect(getDeckPrefs("French")).toEqual({});
  });

  it("keeps a deck's other preferences when one changes", () => {
    setDeckPref("Spanish", "noteType", "Cloze");
    setDeckPref("Spanish", "ttsVoiceId", "voice-es");
    setDeckPref("Spanish", "noteType", "Basic");

    expect(getDeckPrefs("Spanish")).toEqual({
      noteType: "Basic",
      ttsVoiceId: "voice-es",
    });
  });

  // Otherwise every deck ever opened accumulates an empty entry.
  it("drops a deck from storage once its last preference is cleared", () => {
    setDeckPref("Spanish", "noteType", "Cloze");
    setDeckPref("Spanish", "noteType", undefined);

    expect(getDeckPrefs("Spanish")).toEqual({});
    expect(store.get("ankitron.deck-prefs")).toBe("{}");
  });

  // Preferences are keyed by deck name, so a rename has to carry them across or
  // the deck silently reverts to the defaults.
  it("follows a rename, subdecks included", () => {
    setDeckPref("Spanish", "noteType", "Cloze");
    setDeckPref("Spanish::Verbs", "ttsVoiceId", "voice-es");
    setDeckPref("Other", "noteType", "Basic");

    renameDeckPrefs([
      { from: "Spanish", to: "Español" },
      { from: "Spanish::Verbs", to: "Español::Verbs" },
    ]);

    expect(getDeckPrefs("Español")).toEqual({ noteType: "Cloze" });
    expect(getDeckPrefs("Español::Verbs")).toEqual({ ttsVoiceId: "voice-es" });
    expect(getDeckPrefs("Spanish")).toEqual({});
    expect(getDeckPrefs("Spanish::Verbs")).toEqual({});
    // An unrelated deck is untouched.
    expect(getDeckPrefs("Other")).toEqual({ noteType: "Basic" });
  });

  it("survives a corrupted store rather than throwing on every read", () => {
    store.set("ankitron.deck-prefs", "not json");
    expect(getDeckPrefs("Spanish")).toEqual({});

    // And writing recovers it.
    setDeckPref("Spanish", "noteType", "Cloze");
    expect(getDeckPrefs("Spanish")).toEqual({ noteType: "Cloze" });
  });
});
