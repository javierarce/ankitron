import { describe, it, expect } from "vitest";
import { mockAnki } from "./mock-anki";

describe("demo mock flag persistence", () => {
  it("setSpecificValueOfCard persists and flag: search finds it", async () => {
    const names = (await mockAnki("deckNames")) as string[];
    const deck = names.find((n) => !n.includes("::")) ?? names[0];
    const noteIds = (await mockAnki("findNotes", { query: `deck:"${deck}"` })) as number[];
    expect(noteIds.length).toBeGreaterThan(0);
    const info = (await mockAnki("notesInfo", { notes: [noteIds[0]] })) as { cards: number[] }[];
    const cid = info[0].cards[0];

    await mockAnki("setSpecificValueOfCard", { card: cid, keys: ["flags"], newValues: ["3"] });
    const green = (await mockAnki("findCards", { query: "flag:3" })) as number[];
    expect(green).toContain(cid);

    await mockAnki("setSpecificValueOfCard", { card: cid, keys: ["flags"], newValues: ["0"] });
    const green2 = (await mockAnki("findCards", { query: "flag:3" })) as number[];
    expect(green2).not.toContain(cid);
  });
});
