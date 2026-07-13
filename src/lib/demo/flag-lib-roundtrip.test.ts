import { describe, it, expect, vi } from "vitest";

import { mockAnki } from "./mock-anki";

// Route the app's real ankiFetch through the demo mock, so setNoteFlag /
// fetchCardFlags exercise the exact write the app performs (guarding against a
// regression where the flag value's type stops persisting). Only ankiFetch is
// used from this module here, so the mock replaces just that export.
//
// The mock is handed to the (hoisted) factory through a vi.hoisted() holder,
// assigned after the static import above, and read at call time. Importing
// mock-anki *inside* the factory instead — `vi.mock(..., async () => { await
// import("./mock-anki") })` — deadlocks vitest's module runner under newer Node.
const holder = vi.hoisted(() => ({ ankiFetch: null as null | typeof mockAnki }));
holder.ankiFetch = mockAnki;
vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: (a: string, p: Record<string, unknown>) =>
    holder.ankiFetch!(a, p),
}));
import { setNoteFlag, fetchCardFlags } from "@/lib/flags";

describe("app-level flag write/read through the mock", () => {
  it("persists flags set via setNoteFlag and reads them via fetchCardFlags", async () => {
    const names = (await mockAnki("deckNames")) as string[];
    const noteIds = (await mockAnki("findNotes", {
      query: `deck:"${names[0]}"`,
    })) as number[];
    const cids: number[] = [];
    for (const nid of noteIds.slice(0, 6)) {
      const info = (await mockAnki("notesInfo", { notes: [nid] })) as {
        cards: number[];
      }[];
      cids.push(info[0].cards[0]);
    }

    // Flag them 1..N the way the app does (one setNoteFlag per note's cards).
    for (let i = 0; i < cids.length; i++) await setNoteFlag([cids[i]], i + 1);

    const flags = await fetchCardFlags(cids);
    expect(cids.map((c) => flags.get(c) ?? 0)).toEqual(
      cids.map((_, i) => i + 1),
    );

    // Clearing writes 0 and drops the flag back out of the search.
    await setNoteFlag([cids[0]], 0);
    const after = await fetchCardFlags(cids);
    expect(after.get(cids[0]) ?? 0).toBe(0);
  });
});
