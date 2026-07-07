import { describe, it, expect } from "vitest";
import { notesMatchingSearch } from "./match-query";
import type { DemoNote } from "./fixtures";

// A minimal note; each test overrides the fields it cares about.
function note(over: Partial<DemoNote>): DemoNote {
  return {
    noteId: 1,
    deckName: "Spanish",
    modelName: "Basic",
    front: "",
    back: "",
    tags: [],
    state: "new",
    suspended: false,
    ...over,
  };
}

const NOTES: DemoNote[] = [
  note({ noteId: 1, deckName: "Spanish", front: "el perro", tags: ["animal"] }),
  note({
    noteId: 2,
    deckName: "Spanish::Verbs",
    front: "hablar",
    tags: ["verb"],
    state: "review",
  }),
  note({
    noteId: 3,
    deckName: "French",
    front: "le chien",
    tags: ["animal", "marked"],
    suspended: true,
  }),
  note({ noteId: 4, deckName: "Spanish", front: "la casa", modelName: "Cloze" }),
];

const ids = (query: string) =>
  notesMatchingSearch(NOTES, query)
    .map((n) => n.noteId)
    .sort((a, b) => a - b);

describe("notesMatchingSearch", () => {
  it("returns everything for an empty query", () => {
    expect(ids("")).toEqual([1, 2, 3, 4]);
  });

  it("filters by tag — the core demo bug", () => {
    expect(ids("tag:animal")).toEqual([1, 3]);
    expect(ids("tag:verb")).toEqual([2]);
  });

  it("scopes deck: to the subtree, and deck:X::* to strict subdecks", () => {
    expect(ids('deck:"Spanish"')).toEqual([1, 2, 4]);
    expect(ids('deck:"Spanish::*"')).toEqual([2]);
    expect(ids('deck:"French"')).toEqual([3]);
  });

  it("ANDs terms implicitly and scopes a tag within a deck", () => {
    expect(ids('deck:"Spanish" tag:animal')).toEqual([1]);
    expect(ids('deck:"Spanish" (tag:verb)')).toEqual([2]);
  });

  it("handles negation", () => {
    expect(ids("-tag:animal")).toEqual([2, 4]);
    expect(ids('deck:"Spanish" -tag:animal')).toEqual([2, 4]);
  });

  it("honours the rename exclusion deck:X -deck:X::*", () => {
    expect(ids('deck:"Spanish" -deck:"Spanish::*"')).toEqual([1, 4]);
  });

  it("supports or and grouping", () => {
    expect(ids("tag:verb or tag:marked")).toEqual([2, 3]);
    expect(ids('deck:"Spanish" (tag:animal or note:Cloze)')).toEqual([1, 4]);
  });

  it("filters by note type and card state", () => {
    expect(ids("note:Cloze")).toEqual([4]);
    expect(ids("is:review")).toEqual([2]);
    expect(ids("is:suspended")).toEqual([3]);
    expect(ids("is:new")).toEqual([1, 4]);
  });

  it("matches tag:none against untagged notes", () => {
    expect(ids("tag:none")).toEqual([4]);
  });

  it("matches plain text and wildcards against fields, diacritic-folded", () => {
    expect(ids("perro")).toEqual([1]);
    expect(ids("chi*n")).toEqual([3]);
  });
});
