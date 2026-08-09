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
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";

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

// The editor is a heavy TipTap surface with its own round trips; these tests
// only care about which note the page hands it, so stand it in with a stub.
vi.mock("@/components/card-form", () => ({
  CardForm: ({
    note,
    onClose,
  }: {
    note?: { noteId: number };
    onClose: () => void;
  }) => (
    <div data-testid="stub-form" data-note={note?.noteId}>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
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

// Stands in for the routes the header's menu navigates to, so a test can read
// back where it landed (Stats carries its deck scope in the query string).
function Landed({ name }: { name: string }) {
  const { pathname, search } = useLocation();
  return <div data-testid={name}>{pathname + search}</div>;
}

function renderPage(entry = "/decks/Spanish") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      {/* Always-mounted probe, so a test can read the URL even when the
          destination is the deck page itself (a move lands on one). */}
      <Landed name="location" />
      <Routes>
        <Route path="/decks/:deckName" element={<DeckDetailPage />} />
        <Route path="/decks/:deckName/settings" element={<Landed name="settings" />} />
        <Route path="/stats" element={<Landed name="stats" />} />
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

// How the Stats page's trouble spots link to a card rather than to its deck.
describe("DeckDetailPage ?note= deep link", () => {
  it("opens the linked note's editor and drops the param from the URL", async () => {
    renderPage("/decks/Spanish?note=2");

    const form = await screen.findByTestId("stub-form");
    expect(form.dataset.note).toBe("2");
    // Cleared so a reload — or coming back here — doesn't reopen the editor.
    // Replaced, not pushed, so back doesn't return to the linked URL either.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/decks/Spanish"),
    );
  });

  it("just opens the deck when the note isn't one of its own", async () => {
    renderPage("/decks/Spanish?note=999");
    await screen.findByText("Front 1");

    expect(screen.queryByTestId("stub-form")).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/decks/Spanish");
  });

  // The request belongs to the navigation that carried it. Walking up to the
  // parent deck reloads the page — which unmounts the card list, and with it
  // the memory of having already opened this note — and the parent's search
  // spans the subtree, so it holds the note too: nothing else would keep the
  // editor from reopening on its own.
  it("doesn't reopen the editor after navigating to another deck", async () => {
    const user = userEvent.setup();

    function GoParent() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/decks/Spanish")}>go-parent</button>;
    }

    render(
      <MemoryRouter initialEntries={["/decks/Spanish::Verbs?note=2"]}>
        <GoParent />
        <Routes>
          <Route path="/decks/:deckName" element={<DeckDetailPage />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByText("stub-close"));
    expect(screen.queryByTestId("stub-form")).toBeNull();

    await user.click(screen.getByText("go-parent"));
    await screen.findByText("Front 1");

    expect(screen.queryByTestId("stub-form")).toBeNull();
  });
});

describe("DeckDetailPage header menu", () => {
  // Everything you do TO a deck lives here — the settings page keeps only the
  // deck's options.
  it("holds the deck's actions", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await user.click(screen.getByLabelText("Deck actions"));

    // No Import: it can't be scoped to this deck (its target comes from the
    // file), so it stays on the Decks page rather than implying otherwise here.
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Move", "Export", "Stats", "Settings", "Delete deck"]);
  });

  // Ported from the deck settings page, which used to own Move.
  it("moves the deck under the chosen parent, keeping its name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await user.click(screen.getByLabelText("Deck actions"));
    await user.click(screen.getByRole("button", { name: "Move" }));
    await screen.findByRole("heading", { name: "Move Deck" });

    // Pick a new parent from the deck tree and confirm (the dialog's own button
    // is the last "Move" on screen).
    await user.click(await screen.findByRole("button", { name: "Other" }));
    const moveButtons = screen.getAllByRole("button", { name: "Move" });
    await user.click(moveButtons[moveButtons.length - 1]);

    // The leaf is preserved, and the page follows the deck to its new home.
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/decks/Other%3A%3ASpanish",
      );
    });
    expect(screen.queryByRole("heading", { name: "Move Deck" })).toBeNull();
  });

  // Ported from the settings page's Danger Zone.
  it("deletes the deck and leaves for the deck list", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await user.click(screen.getByLabelText("Deck actions"));
    await user.click(screen.getByRole("button", { name: "Delete deck" }));
    await screen.findByRole("heading", { name: "Delete Deck" });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/decks");
    });
    expect(state.decks.has("Spanish")).toBe(false);
  });

  it("opens this deck's stats, scoped by the query string", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await user.click(screen.getByLabelText("Deck actions"));
    await user.click(screen.getByRole("button", { name: "Stats" }));

    expect((await screen.findByTestId("stats")).textContent).toBe(
      "/stats?deck=Spanish",
    );
  });

  // Settings moved off the header into the same menu; it must still act on the
  // deck the header is showing.
  it("still reaches deck settings", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: /Verbs/i });

    await user.click(screen.getByLabelText("Deck actions"));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect((await screen.findByTestId("settings")).textContent).toBe(
      "/decks/Spanish/settings",
    );
  });

  // Everything else in the header follows a scoped subdeck; Stats does too, so
  // scoping the list to "Verbs" and opening Stats doesn't silently widen back
  // out to the parent deck.
  it("follows the scoped subdeck", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Verbs/i }));
    const heading = screen.getByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(within(heading).getByTitle("Rename subdeck")).toBeTruthy(),
    );

    await user.click(screen.getByLabelText("Deck actions"));
    await user.click(screen.getByRole("button", { name: "Stats" }));

    expect((await screen.findByTestId("stats")).textContent).toBe(
      "/stats?deck=Spanish%3A%3AVerbs",
    );
  });
});
