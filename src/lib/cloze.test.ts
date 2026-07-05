import { describe, it, expect } from "vitest";
import {
  CLOZE_OPEN_RE,
  clozeParts,
  hasClozePattern,
  stripCloze,
} from "./cloze";

describe("clozeParts", () => {
  it("returns a bare answer when there is no hint", () => {
    expect(clozeParts("Paris")).toEqual({ answer: "Paris" });
  });

  it("splits answer and hint at the last '::'", () => {
    expect(clozeParts("Paris::city")).toEqual({
      answer: "Paris",
      hint: "city",
    });
    // An answer containing "::" keeps everything before the *last* separator.
    expect(clozeParts("a::b::hint")).toEqual({ answer: "a::b", hint: "hint" });
  });
});

describe("stripCloze", () => {
  it("replaces each deletion with its answer", () => {
    expect(stripCloze("The capital of {{c1::France}} is {{c2::Paris}}.")).toBe(
      "The capital of France is Paris.",
    );
  });

  it("drops hints", () => {
    expect(stripCloze("{{c1::Paris::the capital}}")).toBe("Paris");
  });

  it("leaves text without clozes untouched", () => {
    expect(stripCloze("plain text")).toBe("plain text");
  });
});

describe("hasClozePattern", () => {
  it("finds a complete deletion", () => {
    expect(hasClozePattern("The capital is {{c1::Paris}}.")).toBe(true);
  });

  it("finds a deletion wrapped in markup", () => {
    expect(hasClozePattern("<div>{{c1::word}}</div>")).toBe(true);
  });

  it("rejects an unclosed marker and plain text", () => {
    expect(hasClozePattern("{{c1::word")).toBe(false);
    expect(hasClozePattern("no cloze here")).toBe(false);
  });
});

describe("CLOZE_OPEN_RE", () => {
  it("matches the opening marker even without closing braces", () => {
    expect(CLOZE_OPEN_RE.test("{{c1::word")).toBe(true);
    expect(CLOZE_OPEN_RE.test("{{c12::word}}")).toBe(true);
    expect(CLOZE_OPEN_RE.test("{{cloze}}")).toBe(false);
  });
});
