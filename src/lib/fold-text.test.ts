import { describe, expect, it } from "vitest";
import { foldText } from "./fold-text";

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
