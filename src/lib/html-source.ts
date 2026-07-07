// Dependency-free HTML pretty-printing and syntax highlighting for the card
// editor's source (raw HTML) view. Both functions are intentionally
// conservative so the source view stays lossless:
//
//  - formatHtml only inserts whitespace where it can't affect rendering: around
//    block-level element boundaries (where leading/trailing whitespace collapses
//    in normal flow). Inline elements and text are emitted verbatim, and raw
//    elements (<pre>, <script>, <style>, <textarea>) keep their content
//    untouched — staying inline unless they're also block-level (<pre>). So
//    re-indenting never changes how the card renders. It is idempotent.
//
//  - highlightHtml emits escaped markup whose *visible* characters (tags
//    stripped, entities decoded) exactly match the input. That invariant lets
//    the highlighted output sit behind the editable textarea in the overlay
//    editor without the caret drifting out of alignment.

import { CLOZE_MULTILINE_SOURCE } from "./cloze";

// Elements whose textual content is not HTML (or whose internal whitespace is
// significant). Their contents are copied through formatting verbatim.
const RAW_ELEMENTS = new Set(["pre", "script", "style", "textarea"]);

// Block-level elements: the ones formatHtml is allowed to put on their own
// indented line, because whitespace adjacent to their boundaries is collapsed.
const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "colgroup",
  "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hgroup", "hr", "html", "li", "main", "nav", "ol", "p", "section",
  "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

// Elements with no closing tag, so they never open an indent level.
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

type TagInfo = { name: string; isClose: boolean; selfClose: boolean };

// Index just past the `>` that closes the tag starting at `start`, skipping any
// `>` that sits inside a quoted attribute value.
function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i + 1;
    }
  }
  return html.length;
}

function parseTag(tag: string): TagInfo | null {
  const m = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(tag);
  if (!m) return null;
  return {
    isClose: m[1] === "/",
    name: m[2].toLowerCase(),
    selfClose: /\/\s*>$/.test(tag),
  };
}

function indexOfCaseInsensitive(haystack: string, needle: string, from: number): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

export function formatHtml(html: string): string {
  const lines: string[] = [];
  let indent = 0;
  // Buffer of inline content (inline tags, text, comments) accumulated until the
  // next block boundary forces it onto its own line.
  let inline = "";

  const pad = (n: number) => "  ".repeat(Math.max(0, n));
  const flushInline = () => {
    // Trimming only removes whitespace adjacent to a block boundary, which is
    // insignificant; internal whitespace is preserved.
    const t = inline.trim();
    if (t) lines.push(pad(indent) + t);
    inline = "";
  };

  let i = 0;
  while (i < html.length) {
    const ch = html[i];

    if (ch !== "<") {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      inline += html.slice(i, end);
      i = end;
      continue;
    }

    // Comments and doctype-like `<! ... >` don't render, so keep them inline to
    // avoid introducing whitespace between the elements they sit between.
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      const end = close === -1 ? html.length : close + 3;
      inline += html.slice(i, end);
      i = end;
      continue;
    }
    if (html.startsWith("<!", i)) {
      const end = tagEnd(html, i);
      inline += html.slice(i, end);
      i = end;
      continue;
    }

    const end = tagEnd(html, i);
    const tag = html.slice(i, end);
    const info = parseTag(tag);

    if (!info) {
      // A stray `<` that isn't a tag — treat as inline text.
      inline += tag;
      i = end;
      continue;
    }

    // Raw elements: copy the whole element (tags + content) through untouched,
    // so their internal whitespace is never reflowed. Only break onto a new line
    // when the element is also block-level (<pre>); <script>/<style>/<textarea>
    // are not, so giving them their own line would inject collapsible whitespace
    // into the surrounding inline flow and change rendering — keep them inline.
    if (RAW_ELEMENTS.has(info.name) && !info.isClose && !info.selfClose) {
      const closeIdx = indexOfCaseInsensitive(html, `</${info.name}`, end);
      const rawEnd = closeIdx === -1 ? html.length : tagEnd(html, closeIdx);
      const raw = html.slice(i, rawEnd);
      if (BLOCK_ELEMENTS.has(info.name)) {
        flushInline();
        lines.push(pad(indent) + raw);
      } else {
        inline += raw;
      }
      i = rawEnd;
      continue;
    }

    if (BLOCK_ELEMENTS.has(info.name)) {
      flushInline();
      if (info.isClose) {
        indent = Math.max(0, indent - 1);
        lines.push(pad(indent) + tag);
      } else if (info.selfClose || VOID_ELEMENTS.has(info.name)) {
        lines.push(pad(indent) + tag);
      } else {
        lines.push(pad(indent) + tag);
        indent++;
      }
      i = end;
      continue;
    }

    // Inline (or unknown) element: keep it on the current line.
    inline += tag;
    i = end;
  }

  flushInline();
  return lines.join("\n");
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESCAPE[c]);
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

// Anki-specific markers worth calling out inside text: cloze deletions and the
// [sound:…] / [anki:…] media tags.
const MARKER_RE = new RegExp(
  `${CLOZE_MULTILINE_SOURCE}|\\[(?:sound|anki):[^\\]]*\\]`,
  "g",
);

function highlightText(text: string): string {
  let out = "";
  let last = 0;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    out += span("tok-anki", m[0]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function highlightAttrs(attrs: string): string {
  let out = "";
  // Each match is whitespace, or an attribute name optionally followed by
  // `=value`. Quoted values capture everything between the quotes (including a
  // stray `>`), bare values run to the next whitespace or `>`.
  const re = /(\s+)|([^\s=/>'"]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    if (m[0] === "") {
      re.lastIndex++;
      if (re.lastIndex > attrs.length) break;
      continue;
    }
    if (m[1]) {
      out += escapeHtml(m[1]);
      continue;
    }
    if (m[2]) out += span("tok-attr", m[2]);
    if (m[3]) out += escapeHtml(m[3]);
    if (m[4]) out += span("tok-value", m[4]);
  }
  return out;
}

function highlightTag(tag: string): string {
  const m = /^(<\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?>)$/.exec(tag);
  if (!m) return escapeHtml(tag);
  const [, open, name, attrs, close] = m;
  return (
    span("tok-punct", open) +
    span("tok-tag", name) +
    highlightAttrs(attrs) +
    span("tok-punct", close)
  );
}

export function highlightHtml(html: string): string {
  let out = "";
  // Alternatives are ordered so every character is consumed: comment, tag, a run
  // of non-`<` text, then a single-char fallback that catches a stray `<`.
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z](?:"[^"]*"|'[^']*'|[^>])*>|[^<]+|[\s\S]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok.startsWith("<!--")) out += span("tok-comment", tok);
    else if (/^<\/?[a-zA-Z]/.test(tok)) out += highlightTag(tok);
    else out += highlightText(tok);
    if (re.lastIndex >= html.length) break;
  }
  return out;
}
