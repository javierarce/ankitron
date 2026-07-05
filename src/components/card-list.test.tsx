// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    onSaved,
    onClose,
  }: {
    deckName: string;
    onSaved?: (n?: unknown) => void;
    onClose: () => void;
  }) => (
    <div data-testid="stub-form" data-deck={deckName}>
      <button onClick={() => onSaved?.()}>stub-save</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));

import { CardList } from "./card-list";

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
