// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { Note } from "@/lib/types";

// Anki is unavailable in tests; the add flow under test never calls it (the
// stubbed form below stands in for the real save), but mock it so any stray
// call resolves harmlessly instead of hitting the network.
vi.mock("@/lib/anki-fetch", () => ({ ankiFetch: vi.fn(async () => undefined) }));

// Replace the real form with a stub that exposes its callbacks as buttons (and
// the deck it was opened on), so tests drive the save/close contract without
// the editor's internals.
vi.mock("./card-form", () => ({
  CardForm: ({
    deckName,
    note,
    position,
    onSaved,
    onClose,
    onMove,
  }: {
    deckName: string;
    note?: { noteId: number };
    position?: { index: number; total: number };
    onSaved?: (n?: unknown) => void;
    onClose: () => void;
    onMove?: (deck: string, isNew: boolean) => void;
  }) => (
    <div
      data-testid="stub-form"
      data-deck={deckName}
      data-note={note?.noteId}
      data-position={position ? `${position.index + 1}/${position.total}` : undefined}
    >
      <button onClick={() => onSaved?.()}>stub-save</button>
      <button onClick={onClose}>stub-close</button>
      <button onClick={() => onMove?.("German", false)}>stub-move-away</button>
      <button onClick={() => onMove?.("Spanish::Verbs", false)}>
        stub-move-subdeck
      </button>
      <button onClick={() => onMove?.("Spanish::Nuevo", true)}>
        stub-move-new-subdeck
      </button>
    </div>
  ),
}));

import { CardList } from "./card-list";
import { ToastProvider } from "./toast-provider";
import { ankiFetch } from "@/lib/anki-fetch";

const baseProps = {
  deckName: "Spanish",
  notes: [],
  showAddForm: true,
};

const renderInRouter = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(cleanup);

describe("CardList add flow", () => {
  const realLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom's location.reload isn't spyable (non-configurable), so swap in a
    // stand-in location to assert whether the component reloads the page.
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
    // jsdom derives localStorage from the document origin via window.location,
    // so the swap above detaches it. CardList reads localStorage on render (its
    // saved sort), so provide a plain in-memory stand-in.
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
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
    delete (window as { localStorage?: Storage }).localStorage;
  });

  it("refreshes in place and closes the form, without a page reload", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onShowAddForm = vi.fn();

    renderInRouter(
      <CardList
        {...baseProps}
        onChanged={onChanged}
        onShowAddForm={onShowAddForm}
      />,
    );

    await user.click(screen.getByText("stub-save"));

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onShowAddForm).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to a full reload when no in-place refresh is provided", async () => {
    const user = userEvent.setup();

    renderInRouter(<CardList {...baseProps} onShowAddForm={vi.fn()} />);

    await user.click(screen.getByText("stub-save"));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("CardList edit form deck", () => {
  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: [],
      cards: [11],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
  ] as Note[];

  it("opens the editor on the note's own subdeck, not the viewed parent", async () => {
    const user = userEvent.setup();

    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={notes}
        noteDecks={{ 1: "Spanish::Verbs" }}
        subdecks={["Spanish::Verbs"]}
        showAddForm={false}
        onShowAddForm={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Hola"));

    expect(screen.getByTestId("stub-form").dataset.deck).toBe("Spanish::Verbs");
  });
});

// How the Stats page's trouble spots link to a specific card: the deck page
// passes the note id down and the list opens its editor.
describe("CardList openNoteId", () => {
  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: [],
      cards: [11],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
    {
      noteId: 2,
      modelName: "Basic",
      tags: [],
      cards: [12],
      fields: { Front: { value: "Adiós", order: 0 }, Back: { value: "Bye", order: 1 } },
    },
  ] as Note[];

  const listWith = (openNoteId: number | null, list: Note[] = notes) => (
    <CardList
      deckName="Spanish"
      notes={list}
      openNoteId={openNoteId}
      showAddForm={false}
      onShowAddForm={vi.fn()}
    />
  );

  it("opens the requested note's editor", () => {
    renderInRouter(listWith(2));

    expect(screen.getByTestId("stub-form").dataset.note).toBe("2");
  });

  // A link built from cached stats can point at a note that has since been
  // deleted or moved out of this deck; the deck still opens normally.
  it("ignores a note the deck doesn't hold", () => {
    renderInRouter(listWith(999));

    expect(screen.queryByTestId("stub-form")).toBeNull();
  });

  // The request outlives the open — the deck page keeps it in state — so the
  // one-shot has to be remembered here. Otherwise the next `notes` array (a
  // post-save refresh, a drag, a delete) reopens what the user just closed.
  it("stays closed once dismissed, even as the note list changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderInRouter(listWith(2));

    await user.click(screen.getByText("stub-close"));
    expect(screen.queryByTestId("stub-form")).toBeNull();

    rerender(<MemoryRouter>{listWith(2, [...notes])}</MemoryRouter>);

    expect(screen.queryByTestId("stub-form")).toBeNull();
  });
});

describe("CardList count label", () => {
  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: [],
      cards: [11],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
    {
      noteId: 2,
      modelName: "Basic",
      tags: [],
      cards: [12],
      fields: { Front: { value: "Adiós", order: 0 }, Back: { value: "Bye", order: 1 } },
    },
  ] as Note[];

  it("labels the count in notes (one row per note), not cards", () => {
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={notes}
        showAddForm={false}
        onShowAddForm={vi.fn()}
      />,
    );

    expect(screen.getByText("2 notes")).toBeTruthy();
  });
});

describe("CardList delete failure", () => {
  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: [],
      cards: [11],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
  ] as Note[];

  it("shows an error toast when the delete call fails", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    // The Tauri proxy rejects with a plain string when Anki is unreachable —
    // not an Error — so the toast should fall back to the fixed copy.
    vi.mocked(ankiFetch).mockRejectedValueOnce("AnkiConnect request failed");

    renderInRouter(
      <ToastProvider>
        <CardList
          deckName="Spanish"
          notes={notes}
          showAddForm={false}
          onShowAddForm={vi.fn()}
          onChanged={onChanged}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(screen.getByText("Delete"));
    // The confirm dialog's destructive button.
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Couldn't delete the note. Is Anki still running?",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Characterization tests for selection, keyboard shortcuts, bulk actions,
// segments, and sort persistence — written to pin behavior before decomposing
// the component into hooks.
// ---------------------------------------------------------------------------

// jsdom's real localStorage can be detached by the location swap in the add
// flow suite above, so give each suite that touches it the same in-memory
// stand-in, restored afterwards.
function installLocalStorageStandIn() {
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
  return () => {
    delete (window as { localStorage?: Storage }).localStorage;
  };
}

// Three notes; noteIds double as creation times, so the default sort
// ("Recently modified", falling back to creation) displays them 3, 2, 1.
const threeNotes = [
  {
    noteId: 1,
    modelName: "Basic",
    tags: [],
    cards: [11],
    fields: { Front: { value: "Uno", order: 0 }, Back: { value: "One", order: 1 } },
  },
  {
    noteId: 2,
    modelName: "Basic",
    tags: [],
    cards: [12],
    fields: { Front: { value: "Dos", order: 0 }, Back: { value: "Two", order: 1 } },
  },
  {
    noteId: 3,
    modelName: "Basic",
    tags: [],
    cards: [13],
    fields: { Front: { value: "Tres", order: 0 }, Back: { value: "Three", order: 1 } },
  },
] as Note[];

const rowFor = (text: string) =>
  screen.getByText(text).closest("[data-note-id]") as HTMLElement;
const checkboxIn = (row: HTMLElement) =>
  within(row).getByRole("button", { name: /select note/i });
const selectedRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-note-id][data-selected]"));

describe("CardList selection", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  function renderList() {
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
  }

  it("selects a note when its checkbox is clicked", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(checkboxIn(rowFor("Dos")));

    expect(screen.getByText("1 note selected")).toBeTruthy();
    expect(selectedRows().map((el) => el.dataset.noteId)).toEqual(["2"]);
  });

  it("shift-click extends the selection as a range in display order", async () => {
    const user = userEvent.setup();
    renderList();

    // Display order is 3, 2, 1. Anchor on the middle row (2), then
    // shift-click the bottom row (1): the range covers 2 and 1 but not 3.
    await user.click(checkboxIn(rowFor("Dos")));
    fireEvent.click(checkboxIn(rowFor("Uno")), { shiftKey: true });

    expect(screen.getByText("2 notes selected")).toBeTruthy();
    expect(selectedRows().map((el) => el.dataset.noteId)).toEqual(["2", "1"]);
  });

  it("clears the selection on Escape", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(checkboxIn(rowFor("Tres")));
    expect(screen.getByText("1 note selected")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.getByText("3 notes")).toBeTruthy();
    expect(selectedRows()).toEqual([]);
  });

  it("selects all visible rows on Cmd/Ctrl+A", async () => {
    const user = userEvent.setup();
    renderList();

    await user.keyboard("{Meta>}a{/Meta}");

    expect(screen.getByText("3 notes selected")).toBeTruthy();
    expect(selectedRows()).toHaveLength(3);
  });
});

describe("CardList keyboard shortcuts", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
    vi.mocked(ankiFetch).mockClear();
  });
  afterEach(() => restoreStorage());

  function renderList() {
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
  }

  it("opens the sequential editor over the selection (display order) on 'e'", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(checkboxIn(rowFor("Dos")));
    await user.click(checkboxIn(rowFor("Uno")));
    await user.keyboard("e");

    const form = screen.getByTestId("stub-form");
    // Display order is 3, 2, 1 — so the run starts on note 2, not note 1.
    expect(form.dataset.note).toBe("2");
    expect(form.dataset.position).toBe("1/2");
  });

  it("suspends the focused row's cards on 's'", async () => {
    const user = userEvent.setup();
    renderList();

    act(() => rowFor("Dos").focus());
    await user.keyboard("s");

    await waitFor(() =>
      expect(ankiFetch).toHaveBeenCalledWith("suspend", { cards: [12] }),
    );
    // The row picks up the suspended badge (dimmed content).
    await waitFor(() =>
      expect(rowFor("Dos").querySelector(".opacity-50")).toBeTruthy(),
    );
  });
});

describe("CardList bulk actions", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
    vi.mocked(ankiFetch).mockClear();
  });
  afterEach(() => restoreStorage());

  it("suspends every selected note's cards via the bulk Suspend button", async () => {
    const user = userEvent.setup();
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await user.click(checkboxIn(rowFor("Uno")));
    await user.click(checkboxIn(rowFor("Tres")));
    await user.click(screen.getByRole("button", { name: /^Suspend/ }));

    // Card ids follow the notes prop order (1 before 3), not display order.
    await waitFor(() =>
      expect(ankiFetch).toHaveBeenCalledWith("suspend", { cards: [11, 13] }),
    );
  });
});

describe("CardList segments", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  it("scopes the list and count to a clicked segment chip, with its own badge", async () => {
    const user = userEvent.setup();
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        noteDecks={{ 1: "Spanish::Verbs", 2: "Spanish", 3: "Spanish" }}
        subdecks={["Spanish::Verbs"]}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    const chip = screen.getByRole("button", { name: /Verbs/ });
    // The chip's badge counts the notes in its subtree.
    expect(within(chip).getByText("1")).toBeTruthy();

    await user.click(chip);

    expect(screen.getByText("Uno")).toBeTruthy();
    expect(screen.queryByText("Dos")).toBeNull();
    expect(screen.queryByText("Tres")).toBeNull();
    expect(screen.getByText("1 note")).toBeTruthy();
  });

  it("reports the scoped subdeck up, and null when cleared", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        noteDecks={{ 1: "Spanish::Verbs", 2: "Spanish", 3: "Spanish" }}
        subdecks={["Spanish::Verbs"]}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
        onScopeChange={onScopeChange}
      />,
    );

    // Reports null once on mount (scoped to "All").
    expect(onScopeChange).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByRole("button", { name: /Verbs/ }));
    expect(onScopeChange).toHaveBeenLastCalledWith("Spanish::Verbs");

    // Clicking the sole selection again clears the scope back to null.
    await user.click(screen.getByRole("button", { name: /Verbs/ }));
    expect(onScopeChange).toHaveBeenLastCalledWith(null);
  });
});

describe("CardList sort persistence", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  it("persists the sort choice to localStorage and reorders the list", async () => {
    const user = userEvent.setup();
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={threeNotes}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Sort notes"), "created-asc");

    expect(window.localStorage.getItem("ankitron:card-sort")).toBe("created-asc");
    const order = Array.from(
      document.querySelectorAll<HTMLElement>("[data-note-id]"),
    ).map((el) => el.dataset.noteId);
    expect(order).toEqual(["1", "2", "3"]);
  });
});

// The leech banner. It stands as long as the deck has leeches: `leech` is an
// ordinary tag, so clearing it off a note that's been dealt with is what makes
// the notice go away.
describe("CardList leech banner", () => {
  // CardList reads localStorage on mount (its saved sort), and the describes
  // above leave the jsdom original detached.
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  // threeNotes with the named notes tagged as leeches.
  const withLeeches = (...ids: number[]) =>
    threeNotes.map((n) =>
      ids.includes(n.noteId) ? ({ ...n, tags: ["leech"] } as Note) : (n as Note),
    );

  const renderList = (notes: Note[], suspendedCardIds: number[] = []) =>
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={notes}
        suspendedCardIds={suspendedCardIds}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

  it("stays out of the way when the deck has no leeches", () => {
    renderList(threeNotes as Note[]);

    expect(screen.queryByText(/leech/i)).toBeNull();
  });

  it("names the count and calls out the suspended ones", () => {
    renderList(withLeeches(1, 2), [11]);

    expect(screen.getByText("2 notes are leeches")).toBeTruthy();
    expect(
      screen.getByText(/1 is suspended/),
    ).toBeTruthy();
  });

  // Showing is not choosing: the click filters and stops there, so the bulk
  // bar's destructive verbs aren't armed over notes the user only asked to see.
  it("shows the leeches without selecting them", async () => {
    const user = userEvent.setup();
    renderList(withLeeches(1, 3));

    await user.click(screen.getByText("Show leeches"));

    expect(screen.queryByText(/notes? selected/)).toBeNull();
  });

  // An earlier selection is of notes that just left the view, so the bulk bar
  // would be offering to act on something off screen.
  it("drops a selection made before the click", async () => {
    const user = userEvent.setup();
    renderList(withLeeches(1, 3));

    await user.click(checkboxIn(rowFor("Dos")));
    expect(screen.getByText("1 note selected")).toBeTruthy();

    await user.click(screen.getByText("Show leeches"));

    expect(screen.queryByText(/notes? selected/)).toBeNull();
  });

  it("filters the list to the leeches and steps aside", async () => {
    const user = userEvent.setup();
    renderList(withLeeches(1));

    await user.click(screen.getByText("Show leeches"));

    expect(
      (screen.getByPlaceholderText("Search notes…") as HTMLInputElement).value,
    ).toBe("tag:leech");
    // Nothing left to announce once the list is showing exactly these notes.
    expect(screen.queryByText("1 note is a leech")).toBeNull();
  });

  // No dismiss: looking at them isn't dealing with them.
  it("is still there on the next visit", () => {
    renderList(withLeeches(1, 2));
    expect(screen.getByText("2 notes are leeches")).toBeTruthy();

    cleanup();
    renderList(withLeeches(1, 2));

    expect(screen.getByText("2 notes are leeches")).toBeTruthy();
  });

  it("goes away once the leech tags are cleared", () => {
    renderList(withLeeches(1, 2));
    expect(screen.getByText("2 notes are leeches")).toBeTruthy();

    // One dealt with and untagged; the other still counts.
    cleanup();
    renderList(withLeeches(2));
    expect(screen.getByText("1 note is a leech")).toBeTruthy();

    cleanup();
    renderList(withLeeches());
    expect(screen.queryByText(/leech/i)).toBeNull();
  });
});

// Forget (Anki's "reset to new"): the action for a note you've just rewritten,
// so the new wording isn't scheduled on the old one's failure history.
describe("CardList forget", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: ["leech"],
      cards: [11, 12],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
  ] as Note[];

  const renderList = () =>
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={notes}
        suspendedCardIds={[11, 12]}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

  it("confirms first, then resets every card of the note", async () => {
    const user = userEvent.setup();
    vi.mocked(ankiFetch).mockClear();
    renderList();

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));

    // Nothing happens on opening the menu item alone.
    expect(ankiFetch).not.toHaveBeenCalledWith("forgetCards", expect.anything());

    await user.click(screen.getByRole("button", { name: "Forget" }));

    await waitFor(() =>
      // Both of the note's cards, so a multi-card note resets as a unit.
      expect(ankiFetch).toHaveBeenCalledWith("forgetCards", { cards: [11, 12] }),
    );
  });

  // Anki's reset clears the queue, which is where suspension lives — so a
  // forgotten card comes back into rotation. The row menu is where that shows.
  it("leaves the note unsuspended, since Anki's reset clears the queue", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByLabelText("Note actions"));
    expect(screen.getByText("Unsuspend")).toBeTruthy();
    await user.click(screen.getByText("Forget"));
    await user.click(screen.getByRole("button", { name: "Forget" }));

    await user.click(screen.getByLabelText("Note actions"));
    await waitFor(() => expect(screen.getByText("Suspend")).toBeTruthy());
  });

  it("backs out cleanly on cancel", async () => {
    const user = userEvent.setup();
    vi.mocked(ankiFetch).mockClear();
    renderList();

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));
    await user.click(screen.getByText("Cancel"));

    expect(ankiFetch).not.toHaveBeenCalledWith("forgetCards", expect.anything());
    await user.click(screen.getByLabelText("Note actions"));
    expect(screen.getByText("Unsuspend")).toBeTruthy();
  });
});

// Moving a note out of the deck from the editor. handleMoveToDeck alone only
// patches the local home-deck map — right for a drag between subdecks, but a
// note that has left the subtree has to leave the list too.
describe("CardList move from the editor", () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installLocalStorageStandIn();
  });
  afterEach(() => restoreStorage());

  const notes = [
    {
      noteId: 1,
      modelName: "Basic",
      tags: [],
      cards: [11],
      fields: { Front: { value: "Hola", order: 0 }, Back: { value: "Hello", order: 1 } },
    },
  ] as Note[];

  // The stub form exposes onMove so the test can drive it without the real
  // picker; the deck it reports is what the panel would have chosen.
  const renderList = (onChanged = vi.fn()) => {
    renderInRouter(
      <CardList
        deckName="Spanish"
        notes={notes}
        subdecks={["Spanish::Verbs"]}
        noteDecks={{ 1: "Spanish" }}
        showAddForm={false}
        onShowAddForm={vi.fn()}
        onChanged={onChanged}
      />,
    );
    return onChanged;
  };

  it("refetches the list when the note leaves the deck", async () => {
    const user = userEvent.setup();
    const onChanged = renderList();

    await user.click(screen.getByText("Hola"));
    await user.click(screen.getByText("stub-move-away"));

    // A refetch with no argument — the note has to disappear from the list,
    // which an in-place patch of a single note can't do.
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith());
    // …and the editor doesn't linger over a deck that no longer holds it.
    expect(screen.queryByTestId("stub-form")).toBeNull();
  });

  // Within the subtree the note legitimately stays, so the cheap patch stands.
  it("stays put for a move into one of its own subdecks", async () => {
    const user = userEvent.setup();
    const onChanged = renderList();

    await user.click(screen.getByText("Hola"));
    await user.click(screen.getByText("stub-move-subdeck"));

    await waitFor(() =>
      expect(screen.getByTestId("stub-form")).toBeTruthy(),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  // A brand-new deck has no segment chip and no due count until the page
  // re-reads its subdecks — onCardsMoved only recounts the ones already known.
  it("refetches for a new subdeck, even inside this deck", async () => {
    const user = userEvent.setup();
    const onChanged = renderList();

    await user.click(screen.getByText("Hola"));
    await user.click(screen.getByText("stub-move-new-subdeck"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith());
    // It stayed in the subtree, so the editor is still up.
    expect(screen.getByTestId("stub-form")).toBeTruthy();
  });

  // handleMoveToDeck toasts its failures rather than throwing, so without a
  // reported result the editor would close over a move that never happened.
  it("leaves the editor alone when the move fails", async () => {
    const user = userEvent.setup();
    vi.mocked(ankiFetch).mockRejectedValueOnce("AnkiConnect request failed");
    const onChanged = renderList();

    await user.click(screen.getByText("Hola"));
    await user.click(screen.getByText("stub-move-away"));

    await waitFor(() => expect(screen.getByTestId("stub-form")).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
