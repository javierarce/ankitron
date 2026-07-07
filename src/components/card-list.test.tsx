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
  }: {
    deckName: string;
    note?: { noteId: number };
    position?: { index: number; total: number };
    onSaved?: (n?: unknown) => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="stub-form"
      data-deck={deckName}
      data-note={note?.noteId}
      data-position={position ? `${position.index + 1}/${position.total}` : undefined}
    >
      <button onClick={() => onSaved?.()}>stub-save</button>
      <button onClick={onClose}>stub-close</button>
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
