import { describe, it, expect, vi } from "vitest";

// Route the app's real ankiFetch through the demo mock, so setNoteFlag /
// fetchCardFlags exercise the exact write the app performs (guarding against a
// regression where the flag value's type stops persisting).
vi.mock("@/lib/anki-fetch", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const { mockAnki } = await import("./mock-anki");
  return {
    ...actual,
    ankiFetch: (a: string, p: Record<string, unknown>) => mockAnki(a, p),
  };
});

import { mockAnki } from "./mock-anki";
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
