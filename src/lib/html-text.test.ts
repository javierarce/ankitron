import { describe, it, expect } from "vitest";
import { decodeHtml, stripHtml, truncate, charBoundary } from "./html-text";

describe("decodeHtml", () => {
  it("decodes the common entities (non-DOM fallback path)", () => {
    expect(decodeHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(
      "a & b <c> \"d\" 'e'",
    );
    expect(decodeHtml("a&nbsp;b")).toBe("a b");
  });

  it("passes plain text through", () => {
    expect(decodeHtml("hello")).toBe("hello");
  });
});

describe("stripHtml", () => {
  // Anki's cardsInfo question HTML leads with the card template's whole
  // stylesheet; a bare tag-strip kept its text and lists opened with
  // ".card { font-family: arial; … }".
  it("removes style and script blocks with their contents", () => {
    expect(
      stripHtml(
        "<style>.card { font-family: arial; }</style><div>el perro</div><script>alert(1)</script>",
      ),
    ).toBe("el perro");
  });

  it("drops tags and trims", () => {
    expect(stripHtml("<div> <b>hola</b> </div>")).toBe("hola");
  });

  it("drops [sound:…] tags", () => {
    expect(stripHtml("hola [sound:hola.mp3]")).toBe("hola");
  });

  it("decodes entities after stripping tags", () => {
    expect(stripHtml("<p>x &amp; y</p>")).toBe("x & y");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcde", 5)).toBe("abcde");
  });

  it("clips long text and appends an ellipsis", () => {
    expect(truncate("abcdef", 5)).toBe("abcde…");
  });
});

describe("charBoundary", () => {
  it("leaves an index that already starts a character alone", () => {
    expect(charBoundary("abc", 2)).toBe(2);
    expect(charBoundary("\u{1F436}a", 2)).toBe(2);
    expect(charBoundary("abc", 0)).toBe(0);
  });

  it("moves an index inside a surrogate pair back to its start", () => {
    expect(charBoundary("a\u{1F436}", 2)).toBe(1);
  });
});

describe("truncate at a surrogate pair", () => {
  it("clips before the pair rather than stranding half of it", () => {
    // Cutting at 5 would land between the emoji's two code units and render
    // the leftover half as "".
    const text = "abcd\u{1F436}efgh";
    expect(truncate(text, 5)).toBe("abcd…");
  });
});
