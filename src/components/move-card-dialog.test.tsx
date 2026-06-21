// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Note } from "@/lib/types";

// Resolve the dialog's deckNames load and the move's write calls harmlessly.
vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string) => {
    if (action === "deckNames") return ["Spanish", "French"];
    return undefined;
  }),
}));

import { MoveCardDialog } from "./move-card-dialog";

// A note that already carries its card ids, so the move skips the findCards
// lookup and goes straight to changeDeck.
const note = { noteId: 1, cards: [10] } as unknown as Note;

afterEach(cleanup);

describe("MoveCardDialog", () => {
  const realLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
  });

  it("calls onMoved and does not reload when a refresh handler is given", async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    const onClose = vi.fn();

    render(
      <MoveCardDialog
        notes={[note]}
        currentDeck="Spanish"
        onClose={onClose}
        onMoved={onMoved}
      />,
    );

    // Wait for the deck list to load so the Move button enables.
    const move = await screen.findByRole("button", { name: "Move" });
    await waitFor(() => expect((move as HTMLButtonElement).disabled).toBe(false));

    await user.click(move);

    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to a full reload when no refresh handler is given", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <MoveCardDialog notes={[note]} currentDeck="Spanish" onClose={onClose} />,
    );

    const move = await screen.findByRole("button", { name: "Move" });
    await waitFor(() => expect((move as HTMLButtonElement).disabled).toBe(false));

    await user.click(move);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });
});
