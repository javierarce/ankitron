import { describe, it, expect } from "vitest";
import {
  tokenize,
  activeTokenAt,
  suggestionsFor,
  applySuggestion,
  effectiveQuery,
  contextQuery,
  highlightQuery,
  hasOperators,
  type SuggestionSources,
} from "./search-query";

const sources: SuggestionSources = {
  decks: ["French", "French::Verbs", "My Deck"],
  tags: ["animal", "marked"],
  models: ["Basic", "Cloze"],
  hasUntagged: true,
};

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("dog cat").map((t) => t.text)).toEqual(["dog", "cat"]);
  });

  it("keeps quoted spans together", () => {
    expect(tokenize('deck:"My Deck" cat').map((t) => t.text)).toEqual([
      'deck:"My Deck"',
      "cat",
    ]);
  });

  it("records offsets", () => {
    expect(tokenize("  dog")).toEqual([{ start: 2, end: 5, text: "dog" }]);
  });

  it("returns nothing for blank input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("activeTokenAt", () => {
  it("finds the token under the caret", () => {
    expect(activeTokenAt("dog cat", 1).text).toBe("dog");
    expect(activeTokenAt("dog cat", 6).text).toBe("cat");
  });

  it("returns an empty token when the caret is in whitespace", () => {
    expect(activeTokenAt("dog cat", 3).text).toBe("dog"); // touching dog's end
    expect(activeTokenAt("dog  cat", 4)).toEqual({ start: 4, end: 4, text: "" });
  });

  it("returns an empty token at the end of a trailing space", () => {
    expect(activeTokenAt("dog ", 4)).toEqual({ start: 4, end: 4, text: "" });
  });
});

describe("suggestionsFor — qualifier keywords", () => {
  it("offers every qualifier for an empty token", () => {
    const s = suggestionsFor({ start: 0, end: 0, text: "" }, sources);
    expect(s.map((x) => x.display)).toContain("deck:");
    expect(s.every((x) => x.continues)).toBe(true);
  });

  it("filters qualifiers by prefix", () => {
    const s = suggestionsFor({ start: 0, end: 2, text: "de" }, sources);
    expect(s.map((x) => x.display)).toEqual(["deck:"]);
  });

  it("offers nothing for a plain word that is not a qualifier prefix", () => {
    expect(suggestionsFor({ start: 0, end: 3, text: "dog" }, sources)).toEqual([]);
  });

  it("preserves a leading negation when completing the keyword", () => {
    const s = suggestionsFor({ start: 0, end: 3, text: "-ta" }, sources);
    expect(s[0].apply).toBe("-tag:");
  });
});

describe("suggestionsFor — values", () => {
  it("lists deck names matching the typed value", () => {
    const s = suggestionsFor({ start: 0, end: 9, text: "deck:Fren" }, sources);
    expect(s.map((x) => x.display)).toEqual(["deck:French", "deck:French::Verbs"]);
    expect(s.every((x) => !x.continues)).toBe(true);
  });

  it("quotes deck values that contain spaces", () => {
    const s = suggestionsFor({ start: 0, end: 6, text: "deck:M" }, sources);
    expect(s[0].apply).toBe('deck:"My Deck"');
  });

  it("offers the fixed is: states", () => {
    const s = suggestionsFor({ start: 0, end: 6, text: "is:sus" }, sources);
    expect(s.map((x) => x.display)).toEqual(["is:suspended"]);
  });

  it("offers the flag colours, each tinted, plus flag:0", () => {
    const s = suggestionsFor({ start: 0, end: 5, text: "flag:" }, sources);
    expect(s.map((x) => x.display)).toEqual([
      "flag:1",
      "flag:2",
      "flag:3",
      "flag:4",
      "flag:5",
      "flag:6",
      "flag:7",
      "flag:0",
    ]);
    // Colour rows carry a tint; "No flag" (flag:0) does not.
    expect(s[0].color).toBeTruthy();
    expect(s[7].color).toBeUndefined();
  });

  it("matches a flag by its colour name", () => {
    const s = suggestionsFor({ start: 0, end: 9, text: "flag:gree" }, sources);
    expect(s.map((x) => x.display)).toEqual(["flag:3"]);
  });

  it("includes tag:none alongside real tags", () => {
    const s = suggestionsFor({ start: 0, end: 4, text: "tag:" }, sources);
    expect(s.map((x) => x.display)).toEqual(["tag:none", "tag:animal", "tag:marked"]);
  });

  it("offers nothing for free-form qualifiers like prop:", () => {
    expect(suggestionsFor({ start: 0, end: 8, text: "prop:ivl" }, sources)).toEqual([]);
  });

  it("offers nothing for an unknown qualifier", () => {
    expect(suggestionsFor({ start: 0, end: 5, text: "xyz:a" }, sources)).toEqual([]);
  });

  it("omits tag:none when nothing in scope is untagged", () => {
    const tagged = { ...sources, hasUntagged: false };
    const s = suggestionsFor({ start: 0, end: 4, text: "tag:" }, tagged, "tag:");
    expect(s.map((x) => x.display)).toEqual(["tag:animal", "tag:marked"]);
  });

  it("omits a value already applied elsewhere in the query", () => {
    const token = activeTokenAt("tag:animal tag:", 15);
    const s = suggestionsFor(token, sources, "tag:animal tag:");
    expect(s.map((x) => x.display)).not.toContain("tag:animal");
    expect(s.map((x) => x.display)).toContain("tag:marked");
  });

  it("keeps offering the value you are actively typing, even fully typed", () => {
    const token = { start: 0, end: 10, text: "tag:animal" };
    const s = suggestionsFor(token, sources, "tag:animal");
    expect(s.map((x) => x.display)).toEqual(["tag:animal"]);
  });

  it("keeps the exact match when a longer value shares the typed prefix", () => {
    const src = {
      ...sources,
      tags: ["cloud", "cloudy", "cloudfront"],
      hasUntagged: false,
    };
    const token = { start: 0, end: 9, text: "tag:cloud" };
    const s = suggestionsFor(token, src, "tag:cloud");
    // "cloud" must stay in — and lead — so Enter selects it, not "cloudy".
    expect(s.map((x) => x.display)).toEqual([
      "tag:cloud",
      "tag:cloudy",
      "tag:cloudfront",
    ]);
  });

  it("omits an is: state already in the query", () => {
    const token = activeTokenAt("is:due is:", 10);
    const s = suggestionsFor(token, sources, "is:due is:");
    expect(s.map((x) => x.display)).not.toContain("is:due");
  });
});

describe("applySuggestion", () => {
  it("completes a keyword and parks the caret after the colon", () => {
    const token = { start: 0, end: 2, text: "de" };
    const s = suggestionsFor(token, sources)[0];
    const r = applySuggestion("de cat", token, s);
    expect(r.query).toBe("deck: cat");
    expect(r.query.slice(0, r.cursor)).toBe("deck:");
  });

  it("completes a value and adds a trailing space", () => {
    const token = { start: 0, end: 9, text: "deck:Fren" };
    const s = suggestionsFor(token, sources)[0];
    const r = applySuggestion("deck:Fren", token, s);
    expect(r.query).toBe("deck:French ");
    expect(r.cursor).toBe(r.query.length);
  });

  it("replaces only the active token, mid-query", () => {
    const token = activeTokenAt("tag:animal deck:Fren", 20);
    const s = suggestionsFor(token, sources)[0];
    const r = applySuggestion("tag:animal deck:Fren", token, s);
    expect(r.query).toBe("tag:animal deck:French ");
  });
});

describe("effectiveQuery", () => {
  it.each(["tag:", "deck:", "is:", "prop:", "-tag:", 'tag:""'])(
    "drops a bare qualifier %j",
    (q) => expect(effectiveQuery(q)).toBe(""),
  );

  it("keeps a qualifier once it has a value", () => {
    expect(effectiveQuery("tag:none")).toBe("tag:none");
    expect(effectiveQuery("tag:a")).toBe("tag:a");
  });

  it("keeps an empty field search, which is meaningful in Anki", () => {
    expect(effectiveQuery("front:")).toBe("front:");
  });

  it("drops only the incomplete part of a multi-term query", () => {
    expect(effectiveQuery("is:due tag:")).toBe("is:due");
    expect(effectiveQuery("dog tag:")).toBe("dog");
    expect(effectiveQuery("deck:French tag:")).toBe("deck:French");
  });

  it("leaves plain text and complete queries untouched", () => {
    expect(effectiveQuery("dog cat")).toBe("dog cat");
    expect(effectiveQuery("")).toBe("");
  });
});

describe("contextQuery", () => {
  it("drops the token under the caret", () => {
    expect(contextQuery("tag:animal", 10)).toBe(""); // editing the only token
    expect(contextQuery("tag:foo tag:ba", 14)).toBe("tag:foo");
    expect(contextQuery("is:due tag:", 11)).toBe("is:due");
    expect(contextQuery("dog cat", 7)).toBe("dog");
  });

  it("keeps every completed token when the caret sits in whitespace", () => {
    expect(contextQuery("tag:foo ", 8)).toBe("tag:foo");
    expect(contextQuery("is:due tag:animal ", 18)).toBe("is:due tag:animal");
  });

  it("is empty for an empty query", () => {
    expect(contextQuery("", 0)).toBe("");
  });
});

describe("highlightQuery", () => {
  const flat = (q: string) =>
    highlightQuery(q).map((s) => `${s.kind}:${s.text}`);

  it("reconstructs the original string exactly", () => {
    for (const q of ["", "  dog ", "deck:French  is:due", 'tag:"a b"']) {
      expect(highlightQuery(q).map((s) => s.text).join("")).toBe(q);
    }
  });

  it("splits a recognised qualifier into keyword and value", () => {
    expect(flat("deck:French")).toEqual(["qualifier:deck:", "value:French"]);
  });

  it("highlights a quoted value", () => {
    expect(flat('deck:"My Deck"')).toEqual([
      "qualifier:deck:",
      'value:"My Deck"',
    ]);
  });

  it("keeps plain words and whitespace plain", () => {
    expect(flat("dog cat")).toEqual(["plain:dog", "plain: ", "plain:cat"]);
  });

  it("does not highlight a half-typed qualifier", () => {
    expect(flat("tag:")).toEqual(["plain:tag:"]);
  });

  it("leaves field/unknown qualifiers plain", () => {
    expect(flat("front:dog")).toEqual(["plain:front:dog"]);
  });

  it("highlights only the qualifier within a mixed query", () => {
    expect(flat("dog tag:animal")).toEqual([
      "plain:dog",
      "plain: ",
      "qualifier:tag:",
      "value:animal",
    ]);
  });
});

describe("hasOperators", () => {
  it.each(["dog", "dog cat", "hello world"])(
    "treats plain text %j as operator-free",
    (q) => expect(hasOperators(q)).toBe(false),
  );

  it.each([
    "deck:French",
    "tag:animal",
    "is:due",
    "-cat",
    "dog or cat",
    "(a or b)",
    "d*g",
    '"a phrase"',
    "prop:ivl>10",
  ])("treats %j as an operator query", (q) => expect(hasOperators(q)).toBe(true));
});
