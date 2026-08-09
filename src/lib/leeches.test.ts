import { describe, it, expect } from "vitest";
import { countLeeches, isLeech, isLeechQuery, leechSummary } from "./leeches";

const note = (tags: string[], cards: number[] = []) => ({ tags, cards });
const suspended = (ids: number[]) => (n: { cards: number[] }) =>
  n.cards.some((id) => ids.includes(id));

describe("isLeech", () => {
  it("reads Anki's leech tag", () => {
    expect(isLeech(note(["leech", "spanish"]))).toBe(true);
    expect(isLeech(note(["spanish"]))).toBe(false);
  });
});

describe("countLeeches", () => {
  it("counts leeches and how many of them are suspended", () => {
    const notes = [
      note(["leech"], [1]),
      note(["leech"], [2]),
      note([], [3]),
      note(["marked"], [4]),
    ];

    expect(countLeeches(notes, suspended([2]))).toEqual({
      total: 2,
      suspended: 1,
    });
  });

  it("is zero for a deck with none", () => {
    expect(countLeeches([note([], [1])], suspended([1]))).toEqual({
      total: 0,
      suspended: 0,
    });
  });
});

describe("isLeechQuery", () => {
  it("recognises the query the banner sets", () => {
    expect(isLeechQuery("tag:leech")).toBe(true);
    expect(isLeechQuery("hola tag:leech")).toBe(true);
    expect(isLeechQuery("tag:leech is:suspended")).toBe(true);
    expect(isLeechQuery("(tag:leech or tag:marked)")).toBe(true);
    expect(isLeechQuery("TAG:LEECH")).toBe(true);
  });

  // A different tag that merely starts the same is a different search, so the
  // banner should stay up.
  it("doesn't match a longer tag or a plain-text search", () => {
    expect(isLeechQuery("tag:leeches")).toBe(false);
    expect(isLeechQuery("leech")).toBe(false);
    expect(isLeechQuery("")).toBe(false);
  });
});

describe("leechSummary", () => {
  const of = (total: number, suspended: number) => ({ total, suspended });

  it("reads naturally for one note", () => {
    expect(leechSummary(of(1, 0))).toEqual({
      title: "1 note is a leech",
      detail: "You keep forgetting it.",
    });
    expect(leechSummary(of(1, 1)).detail).toBe(
      "You keep forgetting it. It's suspended.",
    );
  });

  it("calls out the suspended ones", () => {
    expect(leechSummary(of(3, 0))).toEqual({
      title: "3 notes are leeches",
      detail: "You keep forgetting them.",
    });
    expect(leechSummary(of(3, 1)).detail).toBe(
      "You keep forgetting them. 1 is suspended.",
    );
    expect(leechSummary(of(3, 2)).detail).toBe(
      "You keep forgetting them. 2 are suspended.",
    );
    expect(leechSummary(of(3, 3)).detail).toBe(
      "You keep forgetting them. All are suspended.",
    );
  });
});
