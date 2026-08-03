import { describe, expect, it } from "vitest";
import { foldText, foldWithMap } from "./fold-text";

describe("foldText", () => {
  it("strips diacritics so accented and plain letters match", () => {
    expect(foldText("Bäckerei")).toBe("backerei");
    expect(foldText("café")).toBe("cafe");
    expect(foldText("naïve résumé")).toBe("naive resume");
  });

  it("lowercases", () => {
    expect(foldText("HÉLLO")).toBe("hello");
  });

  it("folds already-decomposed input the same as precomposed", () => {
    // "e" + combining acute (U+0301) folds like the precomposed "\u00e9".
    const decomposed = "caf\u0065\u0301";
    expect(foldText(decomposed)).toBe("cafe");
    expect(foldText(decomposed)).toBe(foldText("caf\u00e9"));
  });

  it("leaves unaccented text untouched", () => {
    expect(foldText("hello world")).toBe("hello world");
  });

  it("keeps the length of precomposed accented text (for highlight indices)", () => {
    expect(foldText("Bäckerei")).toHaveLength("Bäckerei".length);
  });
});

describe("foldWithMap", () => {
  it("folds the same as foldText", () => {
    for (const s of ["Bäckerei", "HÉLLO", "hello world", ""]) {
      expect(foldWithMap(s).folded).toBe(foldText(s));
    }
  });

  it("maps each folded character back to where it came from", () => {
    const { folded, map } = foldWithMap("Bäckerei");
    expect(folded).toBe("backerei");
    // One entry per folded character plus the end sentinel, so an exclusive
    // end offset maps back too.
    expect(map).toHaveLength(folded.length + 1);
    expect(map[map.length - 1]).toBe("Bäckerei".length);
  });

  it("maps a decomposed character to the source run including its accent", () => {
    const source = "café".normalize("NFD"); // 5 code units, folds to 4
    const { folded, map } = foldWithMap(source);
    expect(folded).toBe("cafe");
    // The folded "e" covers both the "e" and the combining acute after it.
    expect(source.slice(map[3], map[4])).toBe("é");
  });

  it("keeps a surrogate pair whole", () => {
    const { folded, map } = foldWithMap("\u{1F436}a");
    expect(map[map.length - 1]).toBe(3);
    // Whatever the emoji folds to, the trailing "a" still maps onto itself.
    expect("\u{1F436}a".slice(map[folded.length - 1], map[folded.length])).toBe("a");
  });
});

describe("foldText and foldWithMap agree", () => {
  // foldWithMap folds character by character (it has to, to track offsets), so
  // any position-dependent lowercasing would split the two apart — and the
  // search filter folds whole strings while the highlighter folds mapped ones.
  // A row would then match but show no highlight.
  it.each([
    "ΟΔΟΣ", // ΟΔΟΣ — capital sigma lowercases by position
    "οδος", // οδος — already-final sigma
    "Bäckerei",
    "HÉLLO",
    "hello world",
    "\u{1F436} dog",
    "",
  ])("folds %j the same either way", (s) => {
    expect(foldWithMap(s).folded).toBe(foldText(s));
  });

  it("matches a word ending in sigma however it was typed", () => {
    expect(foldText("ΟΔΟΣ")).toBe(foldText("οδοσ"));
    expect(foldText("οδος")).toBe(foldText("οδοσ"));
  });
});
