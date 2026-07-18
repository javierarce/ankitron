// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

// A tiny in-memory AnkiConnect: a parent deck "Spanish" with a subdeck
// "Spanish::Verbs", each holding one card. Enough for the deck page to load,
// render the subdeck segment chips, scope to a subdeck, and run renameDeck's
// create/move/delete emulation.
const { state, reset, gate } = vi.hoisted(() => {
  const state = {
    decks: new Set<string>(),
    cardDeck: new Map<number, string>(),
    noteCard: new Map<number, number>(),
  };
  // An optional latch a test can set to hold renameDeck's final delete open,
  // simulating a slow round trip so a mid-flight navigation can race it.
  const gate = { wait: null as Promise<void> | null };
  const reset = () => {
    state.decks = new Set(["Spanish", "Spanish::Verbs", "Other"]);
    state.cardDeck = new Map([
      [10, "Spanish"],
      [20, "Spanish::Verbs"],
      [30, "Other"],
    ]);
    state.noteCard = new Map([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);
    gate.wait = null;
  };
  reset();
  return { state, reset, gate };
});

function matchDeckQuery(query: string): number[] {
  if (/^flag:\d$/.test(query)) return [];
  const inc = /deck:"([^"]+)"/.exec(query);
  const excSub = /-deck:"([^"]+)::\*"/.exec(query);
  if (!inc) return [];
  const parent = inc[1];
  const cards: number[] = [];
  for (const [cid, deck] of state.cardDeck) {
    const inSubtree = deck === parent || deck.startsWith(parent + "::");
    if (excSub) {
      if (deck === parent) cards.push(cid);
    } else if (inSubtree) {
      cards.push(cid);
    }
  }
  return cards;
}

interface FetchParams {
  query?: string;
  notes?: number[];
  cards?: number[];
  deck?: string;
  decks?: string[];
}

vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string, params: FetchParams = {}) => {
    switch (action) {
      case "findNotes": {
        const cards = matchDeckQuery(params.query ?? "");
        const noteIds: number[] = [];
        for (const [nid, cid] of state.noteCard)
          if (cards.includes(cid)) noteIds.push(nid);
        return noteIds;
      }
      case "findCards":
        return matchDeckQuery(params.query ?? "");
      case "notesInfo":
        return (params.notes ?? []).map((nid: number) => ({
          noteId: nid,
          modelName: "Basic",
          tags: [],
          fields: {
            Front: { value: `Front ${nid}`, order: 0 },
            Back: { value: `Back ${nid}`, order: 1 },
          },
          cards: [state.noteCard.get(nid)],
          mod: 1,
        }));
      case "getDecks": {
        const out: Record<string, number[]> = {};
        for (const cid of params.cards ?? []) {
          const d = state.cardDeck.get(cid);
          if (d) (out[d] ??= []).push(cid);
        }
        return out;
      }
      case "areSuspended":
        return (params.cards ?? []).map(() => false);
      case "deckNames":
        return [...state.decks];
      case "deckNamesAndIds": {
        const out: Record<string, number> = {};
        let i = 1;
        for (const d of state.decks) out[d] = i++;
        return out;
      }
      case "getDeckConfig":
        return { id: 1 };
      case "createDeck":
        state.decks.add(params.deck!);
        return 99;
      case "changeDeck":
        for (const cid of params.cards ?? [])
          state.cardDeck.set(cid, params.deck!);
        return null;
      case "setDeckConfigId":
        return null;
      case "deleteDecks":
        if (gate.wait) await gate.wait;
        for (const d of params.decks ?? []) state.decks.delete(d);
        return null;
      default:
        return null;
    }
  }),
  fetchAllDueCounts: vi.fn(async () => ({})),
  fetchDueCount: vi.fn(async () => ({ new: 0, learn: 0, review: 0 })),
}));

import { DeckDetailPage } from "./deck-detail";
import { ankiFetch } from "@/lib/anki-fetch";

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

beforeEach(reset);
afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/decks/Spanish"]}>
      <Routes>
        <Route path="/decks/:deckName" element={<DeckDetailPage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renameTopDeck(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  const title = await screen.findByTitle("Rename deck");
  await user.click(title);
  const input = screen.getByLabelText("Deck name");
  await user.clear(input);
  await user.type(input, name);
  await user.keyboard("{Enter}");
}

// Renaming used to blank the page: the destination render carried the old
// deck's subdecks under the new deck name (buildSubdeckTree crashed), and a
// "%" in the name double-decoded into a URIError.
describe("DeckDetailPage inline rename", () => {
  it("renames a top-level deck (that has a subdeck) in place, without reloading", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByRole("button", { name: /Verbs/i });
    // The note list is loaded up front.
    expect(screen.getByText("Front 1")).toBeTruthy();

    vi.mocked(ankiFetch).mockClear();
    await renameTopDeck(user, "Español");

    await waitFor(() => {
      expect(screen.queryByTestId("elsewhere")).toBeNull();
      expect(container.querySelector("h1")).not.toBeNull();
      // Title and subdeck chip follow the new name…
      expect(screen.getByTitle("Rename deck").textContent).toContain("Español");
      expect(screen.getByRole("button", { name: /Verbs/i })).toBeTruthy();
      // …and the note list stayed put rather than blanking on a reload.
      expect(screen.getByText("Front 1")).toBeTruthy();
    });
    // No refetch for the renamed deck: the page never re-queried its notes.
    expect(
      vi.mocked(ankiFetch).mock.calls.some(([action]) => action === "findNotes"),
    ).toBe(false);
  });

  it("does not white-screen when the new name contains a percent sign", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await renameTopDeck(user, "50% done");

    await waitFor(() => {
      expect(screen.queryByTestId("elsewhere")).toBeNull();
      expect(container.querySelector("h1")).not.toBeNull();
    });
  });

  it("renames a scoped subdeck in place — stays on the parent page, keeps the scope", async () => {
    const user = userEvent.setup();
    renderPage();

    const verbsChip = await screen.findByRole("button", { name: /Verbs/i });
    await user.click(verbsChip);

    const heading = screen.getByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(within(heading).getByTitle("Rename subdeck")).toBeTruthy(),
    );
    await user.click(within(heading).getByTitle("Rename subdeck"));

    const input = screen.getByLabelText("Subdeck name");
    await user.clear(input);
    await user.type(input, "Verbos");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      // No navigation: still on the parent deck's page.
      expect(screen.queryByTestId("elsewhere")).toBeNull();
      const h1 = screen.getByRole("heading", { level: 1 });
      // The parent title is still "Spanish"…
      expect(h1.textContent).toContain("Spanish");
      // …and the scoped subdeck (header title + its chip) now reads "Verbos".
      expect(within(h1).getByTitle("Rename subdeck").textContent).toContain(
        "Verbos",
      );
      // Both the header title and the subdeck chip now read "Verbos".
      expect(screen.getAllByRole("button", { name: /Verbos/i }).length).toBe(2);
      // The old name is gone from the subdeck chips.
      expect(screen.queryByRole("button", { name: /^Verbs$/ })).toBeNull();
    });
  });

  it("ignores a self-rename that resolves after the user has navigated away", async () => {
    const user = userEvent.setup();
    // Hold renameDeck's final delete open so we can navigate away mid-flight.
    let releaseDelete!: () => void;
    gate.wait = new Promise<void>((res) => {
      releaseDelete = res;
    });

    function GoOther() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/decks/Other")}>go-other</button>;
    }

    render(
      <MemoryRouter initialEntries={["/decks/Spanish"]}>
        <GoOther />
        <Routes>
          <Route path="/decks/:deckName" element={<DeckDetailPage />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /Verbs/i });

    // Start renaming the opened deck; it blocks on the gated delete.
    await user.click(screen.getByTitle("Rename deck"));
    const input = screen.getByLabelText("Deck name");
    await user.clear(input);
    await user.type(input, "Español");
    await user.keyboard("{Enter}");

    // Navigate to another deck before the rename resolves.
    await user.click(screen.getByText("go-other"));
    await screen.findByText("Front 3");

    // Let the rename finish now that we've moved on, and flush the resumed
    // handler (renameDeck resolves → applyRename continues past its await).
    await act(async () => {
      releaseDelete();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // We stay on "Other" — not yanked back to the renamed deck, and definitely
    // not showing Spanish's notes under the "Español" title.
    expect(screen.getByTitle("Rename deck").textContent).toContain("Other");
    expect(screen.getByText("Front 3")).toBeTruthy();
    expect(screen.queryByText("Front 1")).toBeNull();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    expect(screen.getByTitle("Rename deck").textContent).not.toContain(
      "Español",
    );
  });
});
