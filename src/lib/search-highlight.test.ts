import { describe, expect, it } from "vitest";
import { clipToMatch, matchRanges } from "./search-highlight";

/** The substrings the ranges point at — what would end up inside a <mark>. */
function marked(text: string, ranges: { start: number; end: number }[]) {
  return ranges.map((r) => text.slice(r.start, r.end));
}

describe("matchRanges", () => {
  it("finds a term regardless of case", () => {
    const text = "The Dog barks";
    expect(marked(text, matchRanges(text, ["dog"]))).toEqual(["Dog"]);
  });

  it("finds every occurrence, in order", () => {
    expect(matchRanges("dog eat dog", ["dog"])).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("returns nothing for an empty term list or empty text", () => {
    expect(matchRanges("anything", [])).toEqual([]);
    expect(matchRanges("", ["dog"])).toEqual([]);
  });

  it("matches a multi-word phrase as a whole", () => {
    const text = "a big dog house";
    expect(marked(text, matchRanges(text, ["big dog"]))).toEqual(["big dog"]);
  });

  it("merges overlapping matches into one range", () => {
    // "dog" and "ogg" overlap; two nested marks would duplicate the text.
    expect(matchRanges("dogged", ["dog", "ogg"])).toEqual([
      { start: 0, end: 4 },
    ]);
  });

  it("matches diacritics folded, and marks the accented characters", () => {
    const text = "Die Bäckerei"; // precomposed "ä"
    expect(marked(text, matchRanges(text, ["backerei"]))).toEqual([
      "Bäckerei",
    ]);
  });

  it("covers the accent when the source is already decomposed", () => {
    // "a" + combining diaeresis, as macOS and some IMEs produce. Folding drops
    // the mark, so the folded string is shorter than the source here and the
    // match still has to be reported in source offsets.
    const text = "Die Bäckerei";
    expect(marked(text, matchRanges(text, ["backerei"]))).toEqual([
      "Bäckerei",
    ]);
  });

  it("keeps offsets correct when decomposed accents precede the match", () => {
    // The naive approach — matching in the folded string, then slicing the
    // source with those offsets — drifts by one per accent, marking "g b" here.
    const text = "café résumé dog barks";
    expect(marked(text, matchRanges(text, ["dog"]))).toEqual(["dog"]);
  });

  it("keeps offsets correct after a surrogate pair", () => {
    const text = "\u{1F436} dog";
    expect(marked(text, matchRanges(text, ["dog"]))).toEqual(["dog"]);
  });
});

describe("clipToMatch", () => {
  it("truncates from the head and marks nothing without terms", () => {
    const clipped = clipToMatch("x".repeat(100), 80, []);
    expect(clipped.text).toBe("x".repeat(80) + "…");
    expect(clipped.ranges).toEqual([]);
  });

  it("leaves short text untouched", () => {
    const clipped = clipToMatch("a dog", 80, ["dog"]);
    expect(clipped.text).toBe("a dog");
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog"]);
  });

  it("keeps the head window when the match fits inside it", () => {
    const clipped = clipToMatch("the dog " + "x".repeat(200), 80, ["dog"]);
    expect(clipped.text.startsWith("the dog ")).toBe(true);
    expect(clipped.text.endsWith("…")).toBe(true);
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog"]);
  });

  it("slides the window to bring a late match into view", () => {
    const text = "filler ".repeat(20) + "the dog barks";
    const clipped = clipToMatch(text, 80, ["dog"]);
    expect(clipped.text.startsWith("…")).toBe(true);
    // The whole point: the match survives clipping and is marked.
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog"]);
  });

  it("slides rather than half-marking a match that straddles the cut", () => {
    const text = "x ".repeat(40) + "dog" + " y".repeat(40);
    const clipped = clipToMatch(text, 80, ["dog"]);
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog"]);
  });

  it("opens the slid window on a word boundary", () => {
    const text = "filler ".repeat(20) + "the dog barks";
    const clipped = clipToMatch(text, 80, ["dog"]);
    expect(clipped.text).toMatch(/^…\S/);
    expect(clipped.text.slice(1).startsWith("filler")).toBe(true);
  });

  it("gives up on a match past the scan limit instead of scanning the field", () => {
    const clipped = clipToMatch("x".repeat(500) + " dog", 80, ["dog"]);
    expect(clipped.ranges).toEqual([]);
    expect(clipped.text).toBe("x".repeat(80) + "…");
  });

  it("marks every visible occurrence, not just the first", () => {
    const clipped = clipToMatch("dog and dog", 80, ["dog"]);
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog", "dog"]);
  });
});

describe("matchRanges repeats and boundaries", () => {
  it("counts repeats without overlapping them", () => {
    // "ana" occurs once in "banana" the way a reader counts it; scanning
    // overlapped would merge two hits into one mark spanning "anana".
    expect(matchRanges("banana", ["ana"])).toEqual([{ start: 1, end: 4 }]);
    expect(matchRanges("aaa", ["aa"])).toEqual([{ start: 0, end: 2 }]);
  });

  it("joins back-to-back repeats into one mark", () => {
    // Two hits at [0,2) and [2,4). They abut, so they render as one run —
    // adjacent <mark>s would otherwise show a seam where their padding meets.
    expect(matchRanges("aaaa", ["aa"])).toEqual([{ start: 0, end: 4 }]);
  });

  it("matches Greek regardless of which sigma was typed", () => {
    const text = "Η ΟΔΟΣ είναι";
    expect(marked(text, matchRanges(text, ["οδοσ"]))).toEqual(["ΟΔΟΣ"]);
    expect(marked(text, matchRanges(text, ["οδος"]))).toEqual(["ΟΔΟΣ"]);
  });
});

describe("clipToMatch at a surrogate pair", () => {
  it("never strands half a surrogate pair at either edge", () => {
    // An emoji straddling both the slid window's start and its end.
    const text = "\u{1F436}".repeat(60) + "dog" + "\u{1F436}".repeat(60);
    const clipped = clipToMatch(text, 80, ["dog"]);
    expect(marked(clipped.text, clipped.ranges)).toEqual(["dog"]);
    expect(clipped.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(clipped.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
