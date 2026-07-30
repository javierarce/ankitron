import { describe, it, expect, vi, beforeEach } from "vitest";

// One fake collection: decks mapped to the preset (deck config) each uses.
// Modelled on the real shape that made a collection-wide control wrong — most
// decks on "Default", one deck on its own preset with different values.
const { state } = vi.hoisted(() => ({
  state: {
    deckOf: {} as Record<string, number>,
    presets: {} as Record<number, Record<string, unknown>>,
    failCountFor: null as string | null,
  },
}));

const configFor = (deck: string) => state.presets[state.deckOf[deck]];

vi.mock("./anki-fetch", () => ({
  ankiFetch: vi.fn(
    async (
      action: string,
      params: { deck?: string; config?: Record<string, unknown> } = {},
    ) => {
      if (action === "deckNames") {
        if (state.failCountFor) throw new Error("unreachable");
        return Object.keys(state.deckOf);
      }
      if (action === "getDeckConfig") return { ...configFor(params.deck!) };
      if (action === "saveDeckConfig") {
        const config = params.config!;
        state.presets[config.id as number] = { ...config };
        return null;
      }
      return undefined;
    },
  ),
  ankiMulti: vi.fn(
    async (actions: Array<{ action: string; params?: { deck?: string } }>) =>
      actions.map((a) => ({ ok: true, value: { ...configFor(a.params!.deck!) } })),
  ),
}));

import {
  countDecksSharingOptions,
  getDeckAudioFlag,
  setDeckAudioFlag,
} from "./audio";

beforeEach(() => {
  state.presets = {
    1: { id: 1, name: "Default", autoplay: false, replayq: true },
    2: { id: 2, name: "Default 2", autoplay: true, replayq: false },
  };
  state.deckOf = {
    Spanish: 1,
    "Spanish::Verbs": 1,
    German: 1,
    Conceptos: 2,
  };
  state.failCountFor = null;
});

describe("deck audio flags", () => {
  it("reads the flag off the preset the deck uses", async () => {
    expect(await getDeckAudioFlag("Spanish", "autoplay")).toBe(false);
    expect(await getDeckAudioFlag("Conceptos", "autoplay")).toBe(true);
    expect(await getDeckAudioFlag("Spanish", "replayq")).toBe(true);
    expect(await getDeckAudioFlag("Conceptos", "replayq")).toBe(false);
  });

  // Anki defaults both flags to on, so a preset that omits the key is "on".
  it("treats a missing flag as on", async () => {
    delete state.presets[1].autoplay;
    expect(await getDeckAudioFlag("Spanish", "autoplay")).toBe(true);
  });

  it("writes to that deck's preset and leaves other presets alone", async () => {
    await setDeckAudioFlag("Conceptos", "replayq", true);

    expect(state.presets[2].replayq).toBe(true);
    // The 3 decks on "Default" are untouched.
    expect(state.presets[1].replayq).toBe(true);
    expect(state.presets[1].autoplay).toBe(false);
  });

  // saveDeckConfig replaces the whole object; a patch would wipe the rest.
  it("preserves the rest of the preset when writing", async () => {
    await setDeckAudioFlag("Spanish", "autoplay", true);

    expect(state.presets[1]).toEqual({
      id: 1,
      name: "Default",
      autoplay: true,
      replayq: true,
    });
  });
});

describe("countDecksSharingOptions", () => {
  // The count exists only to warn that a change reaches other decks.
  it("counts the decks on the same preset, this one included", async () => {
    expect(await countDecksSharingOptions("Spanish")).toBe(3);
  });

  it("returns 1 for a preset this deck has to itself", async () => {
    expect(await countDecksSharingOptions("Conceptos")).toBe(1);
  });

  // Null, so the caller stays quiet rather than claiming a deck shares nothing.
  it("returns null when Anki can't be reached", async () => {
    state.failCountFor = "Spanish";
    expect(await countDecksSharingOptions("Spanish")).toBeNull();
  });
});
