// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { DeckRename } from "@/lib/deck";

// useNavigate is stubbed to a no-op: the destination is the same route, so the
// real app reconciles in place rather than remounting. Stubbing navigation means
// the only way the dialog can close after a successful rename is if the page
// resets its own state — which is exactly the bug this test guards.
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

// Anki is unavailable in tests — resolve the page's load/child calls harmlessly.
vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string) => {
    if (action === "findNotes") return [];
    if (action === "getDeckConfig") return { autoplay: true };
    if (action === "deckNames") return ["Spanish", "French", "German"];
    return undefined;
  }),
}));

// Control the rename's outcome and timing without touching Anki.
vi.mock("@/lib/deck", async (orig) => ({
  ...(await orig<typeof import("@/lib/deck")>()),
  renameDeck: vi.fn(),
}));

// The other settings sections aren't under test and pull in speech synthesis,
// Anki config, and localStorage — stub them so the test stays about the dialog.
vi.mock("@/components/deck-settings", () => ({ DeckSettings: () => null }));
vi.mock("@/components/danger-zone", () => ({ DangerZone: () => null }));
vi.mock("@/components/import-export", () => ({ ImportExport: () => null }));

import { renameDeck } from "@/lib/deck";
import { DeckSettingsPage } from "./deck-settings";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/decks/Spanish/settings"]}>
      <Routes>
        <Route
          path="decks/:deckName/settings"
          element={<DeckSettingsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DeckSettingsPage rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom's localStorage is unreliable in this harness; provide a clean one
    // so migrateDeckLanguages (run on the success path) works.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("closes the rename dialog after a successful rename", async () => {
    // A deferred promise so we can observe the in-progress state, then resolve.
    let resolveRename!: (plan: DeckRename[]) => void;
    vi.mocked(renameDeck).mockImplementation(
      () => new Promise((r) => (resolveRename = r)),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Deck Settings" });

    // Open the dialog from the row button.
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await screen.findByRole("heading", { name: "Rename Deck" });

    // Enter a new name and submit (the dialog's button is the second "Rename").
    const input = screen.getByPlaceholderText("Deck name");
    await user.clear(input);
    await user.type(input, "Español");
    const renameButtons = screen.getAllByRole("button", { name: "Rename" });
    await user.click(renameButtons[renameButtons.length - 1]);

    // Mid-flight: the dialog stays open showing progress.
    expect(
      screen.getByRole("button", { name: "Renaming…" }),
    ).toBeTruthy();

    // Finish the rename.
    await act(async () => {
      resolveRename([{ from: "Spanish", to: "Español" }]);
    });

    // The dialog must close even though navigation was stubbed out.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Rename Deck" }),
      ).toBeNull();
    });
    expect(navigate).toHaveBeenCalledWith("/decks/Espa%C3%B1ol/settings", {
      replace: true,
    });
  });

  it("moves the deck under the chosen parent, keeping its name", async () => {
    vi.mocked(renameDeck).mockResolvedValue([
      { from: "Spanish", to: "French::Spanish" },
    ]);

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Deck Settings" });
    await user.click(screen.getByRole("button", { name: "Move" }));
    await screen.findByRole("heading", { name: "Move Deck" });

    // Pick a new parent and confirm.
    await user.selectOptions(screen.getByRole("combobox"), "French");
    const moveButtons = screen.getAllByRole("button", { name: "Move" });
    await user.click(moveButtons[moveButtons.length - 1]);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Move Deck" }),
      ).toBeNull();
    });
    // Renames "Spanish" to "French::Spanish" — the leaf is preserved.
    expect(renameDeck).toHaveBeenCalledWith(
      "Spanish",
      "French::Spanish",
      expect.any(Function),
    );
    expect(navigate).toHaveBeenCalledWith(
      "/decks/French%3A%3ASpanish/settings",
      { replace: true },
    );
  });
});
