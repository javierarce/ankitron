// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Two decks on the "Default" preset, one on its own — the shape that makes the
// preset's reach worth naming.
const { presets } = vi.hoisted(() => ({
  presets: {
    deckOf: { Spanish: 1, "Spanish::Verbs": 1, Conceptos: 2 } as Record<string, number>,
    byId: {
      1: { id: 1, name: "Default", autoplay: true, replayq: true },
      2: { id: 2, name: "Default 2", autoplay: true, replayq: true },
    } as Record<number, Record<string, unknown>>,
  },
}));

const configFor = (deck: string) => presets.byId[presets.deckOf[deck]];

vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(
    async (
      action: string,
      params: { deck?: string; config?: Record<string, unknown> } = {},
    ) => {
      if (action === "findNotes") return [];
      if (action === "deckNames") return Object.keys(presets.deckOf);
      if (action === "getDeckConfig") return { ...configFor(params.deck!) };
      if (action === "saveDeckConfig") {
        presets.byId[params.config!.id as number] = { ...params.config! };
        return null;
      }
      return undefined;
    },
  ),
  ankiMulti: vi.fn(
    async (actions: Array<{ params?: { deck?: string } }>) =>
      actions.map((a) => ({ ok: true, value: { ...configFor(a.params!.deck!) } })),
  ),
}));

// Node 25 defines its own (unusable) global localStorage, which shadows
// jsdom's — so provide the same in-memory stand-in the lib tests use.
let store: Map<string, string>;

import { DeckSettingsPage } from "./deck-settings";
import { getDeckPrefs } from "@/lib/deck-prefs";

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
  presets.byId[1] = { id: 1, name: "Default", autoplay: true, replayq: true };
  presets.byId[2] = { id: 2, name: "Default 2", autoplay: true, replayq: true };
});

afterEach(() => {
  cleanup();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function renderPage(deck = "Spanish::Verbs") {
  return render(
    <MemoryRouter initialEntries={[`/decks/${encodeURIComponent(deck)}/settings`]}>
      <Routes>
        <Route path="decks/:deckName/settings" element={<DeckSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DeckSettingsPage", () => {
  // Rename, Move, Import, Export, and Delete are things you do to a deck rather
  // than ways to configure one; they live in the deck page's header menu now.
  // No heading or deck path either — the breadcrumb above already names both
  // the deck and the page.
  it("shows settings only — no deck actions, no title", async () => {
    renderPage();

    await screen.findByLabelText("New notes start as");
    for (const action of ["Rename", "Move", "Import", "Export", "Delete Deck"]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
    // The page has no title of its own (the breadcrumb names the deck and the
    // page); "Audio" below is a section label, not a heading element.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("Spanish / Verbs")).toBeNull();
    expect(screen.getByText("Audio")).toBeTruthy();
  });

  // The setting only exists to be read back by the Add note form, so what
  // matters is that it lands in the store under this deck.
  it("remembers the note type new notes start on, per deck", async () => {
    const user = userEvent.setup();
    renderPage();

    const select = await screen.findByLabelText("New notes start as");
    await user.selectOptions(select, "Cloze");

    expect(getDeckPrefs("Spanish::Verbs").noteType).toBe("Cloze");
    // A different deck is unaffected — that's the whole point of these being
    // per-deck rather than Anki's shared config.
    expect(getDeckPrefs("Spanish").noteType).toBeUndefined();
  });

  // Without an ElevenLabs key there are no voices to choose from, so the row
  // would be a dead end.
  it("hides the voice picker until ElevenLabs is set up", async () => {
    renderPage();

    await screen.findByLabelText("New notes start as");
    expect(screen.queryByLabelText("Text-to-speech voice")).toBeNull();

    cleanup();
    store.set("elevenlabs-configured", "1");
    store.set(
      "elevenlabs-voices",
      JSON.stringify([{ voiceId: "v-de", name: "Klaus" }]),
    );
    renderPage();

    const picker = await screen.findByLabelText("Text-to-speech voice");
    expect(within(picker).getByRole("option", { name: "Klaus" })).toBeTruthy();
  });

  // Back on the deck page (they were briefly a global setting): Anki keeps them
  // on the deck's preset, so this is where you'd look for them — with a warning
  // only when the change reaches past this deck.
  it("writes the audio flags to this deck's preset", async () => {
    const user = userEvent.setup();
    renderPage("Spanish::Verbs");

    const autoplay = await screen.findByLabelText(/Play card audio/);
    await waitFor(() => expect((autoplay as HTMLInputElement).checked).toBe(true));
    await user.click(autoplay);
    await waitFor(() => expect(presets.byId[1].autoplay).toBe(false));

    const replay = screen.getByLabelText(/question's audio again/);
    await user.click(replay);
    await waitFor(() => expect(presets.byId[1].replayq).toBe(false));

    // The other preset is untouched.
    expect(presets.byId[2]).toMatchObject({ autoplay: true, replayq: true });

    expect(
      await screen.findByText("Changing these also affects 1 other deck."),
    ).toBeTruthy();
  });

  // A preset the deck has to itself has no consequence to report, and Ankitron
  // shows no preset concept anywhere else — so it says nothing at all.
  it("stays quiet when no other deck is affected", async () => {
    renderPage("Conceptos");

    await screen.findByLabelText(/Play card audio/);
    expect(screen.queryByText(/also affects/)).toBeNull();
    expect(screen.queryByText(/preset/i)).toBeNull();
  });
});
