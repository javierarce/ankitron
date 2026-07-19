// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Note } from "@/lib/types";

// Canned scheduling data so the panel's shaping and rendering are deterministic,
// independent of the demo fixtures.
const STUDIED_CARD = {
  cardId: 10,
  ord: 0,
  type: 2,
  queue: 2,
  interval: 15,
  reps: 4,
  lapses: 1,
  factor: 2300,
};
const STUDIED_REVIEWS = [
  { id: 1000, usn: 1, ease: 3, ivl: 1, lastIvl: 0, factor: 2500, time: 4000, type: 0 },
  { id: 2000, usn: 1, ease: 1, ivl: 0, lastIvl: 4, factor: 2300, time: 6000, type: 1 },
  { id: 3000, usn: 1, ease: 3, ivl: 6, lastIvl: 0, factor: 2300, time: 3000, type: 2 },
  { id: 4000, usn: 1, ease: 4, ivl: 15, lastIvl: 6, factor: 2450, time: 2000, type: 1 },
];

vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string) => {
    if (action === "cardsInfo") return [STUDIED_CARD];
    if (action === "getReviewsOfCards") return { "10": STUDIED_REVIEWS };
    return undefined;
  }),
}));

import { NoteStatsPanel } from "./note-stats-panel";

const studiedNote = { noteId: 1, tags: [], cards: [10] } as unknown as Note;

afterEach(cleanup);

describe("NoteStatsPanel", () => {
  it("renders the headline tiles and the history chart for a studied note", async () => {
    render(<NoteStatsPanel note={studiedNote} />);

    // Tiles resolve once the fetch settles (getBy*/findBy* throw if absent).
    expect(await screen.findByText("Reviews")).toBeTruthy();
    expect(screen.getByText("Lapses")).toBeTruthy();
    // 4 reviews, 3 of them passes → 75% success.
    expect(screen.getByText("75%")).toBeTruthy();
    // The interval-growth chart exposes an accessible summary.
    expect(screen.getByRole("img", { name: /interval grew/i })).toBeTruthy();
    // The header readout defaults to the review count.
    expect(screen.getByText("4 reviews")).toBeTruthy();
    // The Ease stat carries an explanatory tooltip (rendered in the DOM).
    expect(screen.getByText(/interval grows on Good/i)).toBeTruthy();
  });

  it("labels each review dot and reflects the hovered one in the readout", async () => {
    const user = userEvent.setup();
    render(<NoteStatsPanel note={studiedNote} />);

    // Every dot is an accessible target named with grade · interval · date. The
    // last review here is Easy at 15 days; the forgotten one is Again at <1d.
    const easy = await screen.findByRole("button", { name: /Easy · 15d/ });
    expect(screen.getByRole("button", { name: /Again · <1d/ })).toBeTruthy();

    // Hovering a dot surfaces its label in the header readout — no floating
    // tooltip to be clipped by the dialog.
    await user.hover(easy);
    expect(screen.getByText(/Easy · 15d/)).toBeTruthy();
  });

  it("shows an empty state for a note with no reviews", async () => {
    const freshNote = { noteId: 2, tags: [], cards: [20] } as unknown as Note;
    const { ankiFetch } = await import("@/lib/anki-fetch");
    (ankiFetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (action: string) => {
        if (action === "cardsInfo")
          return [{ cardId: 20, ord: 0, type: 0, queue: 0, interval: 0, reps: 0, lapses: 0, factor: 0 }];
        if (action === "getReviewsOfCards") return { "20": [] };
        return undefined;
      },
    );

    render(<NoteStatsPanel note={freshNote} />);

    expect(
      await screen.findByText(/hasn't been studied yet/i),
    ).toBeTruthy();
  });
});
