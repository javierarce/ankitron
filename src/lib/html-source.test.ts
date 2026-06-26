import { describe, expect, it } from "vitest";
import { formatHtml, highlightHtml } from "./html-source";

// Collapse insignificant whitespace, mirroring the editor's fidelity check, so
// "renders the same" can be asserted regardless of indentation.
// Whitespace directly adjacent to a tag is insignificant in normal flow, so
// drop it on both sides; what's left is the rendering-relevant text.
function collapse(html: string): string {
  return html.replace(/\s+/g, " ").replace(/\s*</g, "<").replace(/>\s*/g, ">").trim();
}

// Strip the highlighter's spans and decode its entities to recover the visible
// text. This must equal the original input, or the overlay caret would drift.
function visible(highlighted: string): string {
  return highlighted
    .replace(/<\/?span[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("formatHtml", () => {
  it("indents nested block elements onto their own lines", () => {
    const out = formatHtml("<div><p>Hello</p><p>World</p></div>");
    expect(out).toBe(
      ["<div>", "  <p>", "    Hello", "  </p>", "  <p>", "    World", "  </p>", "</div>"].join("\n")
    );
  });

  it("keeps inline elements and text on one line", () => {
    const out = formatHtml("<p>The <b>quick</b> brown <i>fox</i></p>");
    expect(out).toBe(["<p>", "  The <b>quick</b> brown <i>fox</i>", "</p>"].join("\n"));
  });

  it("preserves significant whitespace between inline elements", () => {
    expect(formatHtml("<b>a</b>  <b>b</b>")).toBe("<b>a</b>  <b>b</b>");
  });

  it("does not change how the HTML renders", () => {
    const inputs = [
      "<div><p>Hi</p></div>",
      '<table><tr><td>1</td><td>2</td></tr></table>',
      '<p>see <a href="x">link</a> here</p>',
      "<ul><li>one</li><li>two</li></ul>",
      "plain text with no tags",
    ];
    for (const input of inputs) {
      expect(collapse(formatHtml(input))).toBe(collapse(input));
    }
  });

  it("leaves <pre> content verbatim", () => {
    const input = "<div><pre>  line 1\n  line 2</pre></div>";
    const out = formatHtml(input);
    expect(out).toContain("<pre>  line 1\n  line 2</pre>");
  });

  it("handles void and self-closing elements", () => {
    expect(formatHtml('<div>a<br>b<img src="x"/></div>')).toBe(
      ["<div>", "  a<br>b<img src=\"x\"/>", "</div>"].join("\n")
    );
  });

  it("is idempotent", () => {
    const input = "<div><p>Hello <b>there</b></p><hr><p>Bye</p></div>";
    const once = formatHtml(input);
    expect(formatHtml(once)).toBe(once);
  });
});

describe("highlightHtml", () => {
  it("preserves the visible text exactly", () => {
    const inputs = [
      '<div class="a">hi & <b>bye</b></div>',
      "a < b and c > d",
      "{{c1::answer}} stays",
      "[sound:clip.mp3]",
      '<a title="x>y">z</a>',
      "<!-- a comment -->",
      "plain text",
    ];
    for (const input of inputs) {
      expect(visible(highlightHtml(input))).toBe(input);
    }
  });

  it("tokenizes tag name, attribute, and value", () => {
    const out = highlightHtml('<div class="box">');
    expect(out).toContain('<span class="tok-tag">div</span>');
    expect(out).toContain('<span class="tok-attr">class</span>');
    expect(out).toContain('<span class="tok-value">"box"</span>');
  });

  it("highlights cloze and media markers", () => {
    expect(highlightHtml("{{c1::x}}")).toContain('<span class="tok-anki">{{c1::x}}</span>');
    expect(highlightHtml("[sound:a.mp3]")).toContain('<span class="tok-anki">[sound:a.mp3]</span>');
  });

  it("highlights comments", () => {
    expect(highlightHtml("<!-- note -->")).toContain('<span class="tok-comment">');
  });
});
