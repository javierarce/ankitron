// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Note } from "@/lib/types";

// The panel fetches per-note stats; keep it resolving with empty history.
vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string) => {
    if (action === "cardsInfo")
      return [{ cardId: 10, ord: 0, type: 0, queue: 0, interval: 0, reps: 0, lapses: 0, factor: 0 }];
    if (action === "getReviewsOfCards") return {};
    return undefined;
  }),
}));

import { NoteStatsDialog } from "./note-stats-dialog";

function note(noteId: number, front: string): Note {
  return {
    noteId,
    modelName: "Basic",
    fields: { Front: { value: front, order: 0 }, Back: { value: "answer", order: 1 } },
    tags: [],
    cards: [10],
  } as unknown as Note;
}

const notes = [note(1, "capital of France"), note(2, "capital of Spain")];

afterEach(cleanup);

describe("NoteStatsDialog", () => {
  it("shows the note's front (not the answer) and the position", () => {
    render(
      <NoteStatsDialog notes={notes} index={0} onIndexChange={() => {}} onClose={() => {}} />,
    );

    expect(screen.getByText("capital of France")).toBeTruthy();
    // The back is deliberately not shown.
    expect(screen.queryByText("answer")).toBeNull();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("pages with the arrow buttons and Left/Right keys, within bounds", () => {
    const onIndexChange = vi.fn();
    render(
      <NoteStatsDialog notes={notes} index={0} onIndexChange={onIndexChange} onClose={() => {}} />,
    );

    // At index 0, Left / Previous are no-ops.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowLeft" });
    expect(onIndexChange).not.toHaveBeenCalled();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);

    onIndexChange.mockClear();
    fireEvent.click(screen.getByLabelText("Next note"));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("renders nothing when the index is out of range", () => {
    const { container } = render(
      <NoteStatsDialog notes={notes} index={5} onIndexChange={() => {}} onClose={() => {}} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
