// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { memo, createElement, type ComponentProps } from "react";
import type { Note } from "@/lib/types";

vi.mock("@/lib/anki-fetch", () => ({ ankiFetch: vi.fn(async () => undefined) }));

// Wrap the real NoteRow in a counting memo component that receives the exact
// props CardList passes: React only re-renders it when a prop identity
// changes, so the counts expose whether the parent keeps row props stable.
// This pins the virtualization prerequisite — with a big deck, a selection
// change must re-render the affected rows, not all of them.
const renderCounts = new Map<number, number>();
vi.mock("./card-list-note-row", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./card-list-note-row")>();
  const CountingRow = memo(function CountingRow(
    props: ComponentProps<typeof orig.NoteRow>,
  ) {
    renderCounts.set(
      props.note.noteId,
      (renderCounts.get(props.note.noteId) ?? 0) + 1,
    );
    return createElement(orig.NoteRow, props);
  });
  return { NoteRow: CountingRow };
});

import { CardList } from "./card-list";

const notes = [
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

// This jsdom setup has no working localStorage (CardList reads its saved sort
// on render), so provide the same in-memory stand-in card-list.test.tsx uses.
beforeEach(() => {
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
  cleanup();
  renderCounts.clear();
  delete (window as { localStorage?: Storage }).localStorage;
});

describe("NoteRow memoization", () => {
  it("re-renders only the toggled row when the selection changes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CardList
          deckName="Spanish"
          notes={notes}
          showAddForm={false}
          onShowAddForm={vi.fn()}
          onChanged={vi.fn()}
        />
      </MemoryRouter>,
    );

    const before = new Map(renderCounts);
    const row = screen.getByText("Dos").closest("[data-note-id]") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Select note" }));

    expect(screen.getByText("1 note selected")).toBeTruthy();
    // The clicked row re-rendered (its `selected` flag flipped)…
    expect(renderCounts.get(2)).toBe((before.get(2) ?? 0) + 1);
    // …and the untouched rows did not: their props stayed identity-stable.
    expect(renderCounts.get(1)).toBe(before.get(1));
    expect(renderCounts.get(3)).toBe(before.get(3));
  });
});
