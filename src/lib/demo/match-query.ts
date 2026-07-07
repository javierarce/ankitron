// A small Anki-search evaluator for the demo build.
//
// The real app hands operator queries (`tag:animal`, `is:due`, `deck:"X" or
// …`) to Anki's backend, which understands the full search syntax. The demo has
// no backend, so the mock (mock-anki.ts) evaluates them here instead. This is a
// deliberate *subset* of https://docs.ankiweb.net/searching.html — enough to
// make the qualifiers the app's autocomplete offers actually filter the demo's
// in-memory notes:
//
//   • `deck:`, `tag:`, `is:`, `note:` qualifiers (with `tag:none`)
//   • `*` wildcards, quoted "phrases", and plain-text substring terms
//   • boolean structure: implicit AND, `or`, `-` negation, and `(` grouping `)`
//
// What it can't model, it approximates: `prop:`/`added:`/`edited:`/`rated:` and
// field searches (`front:…`) have no scheduling or per-field data behind them in
// the demo, so they fall back to a text match rather than pretending to be
// precise. A reload resets everything to the fixtures regardless.

import { foldText } from "../fold-text";
import { isCardInDeck } from "../deck";
import type { DemoNote } from "./fixtures";

// --- Lexer -----------------------------------------------------------------

type Token =
  | { t: "(" }
  | { t: ")" }
  | { t: "or" }
  | { t: "not" }
  | { t: "term"; text: string };

// Split a query into tokens. Whitespace separates terms except inside double
// quotes; parentheses are their own tokens; a leading `-` at a token boundary is
// negation (a dash *inside* a term, like `deck:"a-b"`, stays part of it).
function lex(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    const c = query[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(") {
      tokens.push({ t: "(" });
      i++;
    } else if (c === ")") {
      tokens.push({ t: ")" });
      i++;
    } else if (c === "-") {
      tokens.push({ t: "not" });
      i++;
    } else {
      let text = "";
      let inQuote = false;
      while (i < query.length) {
        const ch = query[i];
        if (ch === '"') {
          inQuote = !inQuote;
          text += ch;
          i++;
        } else if (!inQuote && (/\s/.test(ch) || ch === "(" || ch === ")")) {
          break;
        } else {
          text += ch;
          i++;
        }
      }
      if (!inQuote && text.toLowerCase() === "or") tokens.push({ t: "or" });
      else tokens.push({ t: "term", text });
    }
  }
  return tokens;
}

// --- Parser (recursive descent: or > and > not > primary) ------------------

type Node =
  | { op: "true" }
  | { op: "leaf"; text: string }
  | { op: "not"; a: Node }
  | { op: "and"; a: Node; b: Node }
  | { op: "or"; a: Node; b: Node };

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];

  function parseOr(): Node {
    let node = parseAnd();
    while (peek()?.t === "or") {
      pos++;
      node = { op: "or", a: node, b: parseAnd() };
    }
    return node;
  }

  // Implicit AND: keep folding terms until an `or`, a closing paren, or the end.
  function parseAnd(): Node {
    let node = parseNot();
    while (peek() && peek().t !== "or" && peek().t !== ")") {
      node = { op: "and", a: node, b: parseNot() };
    }
    return node;
  }

  function parseNot(): Node {
    if (peek()?.t === "not") {
      pos++;
      return { op: "not", a: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const t = peek();
    if (!t) return { op: "true" }; // nothing left (e.g. empty query) → match all
    if (t.t === "(") {
      pos++;
      const inner = parseOr();
      if (peek()?.t === ")") pos++;
      return inner;
    }
    if (t.t === "term") {
      pos++;
      return { op: "leaf", text: t.text };
    }
    pos++; // stray `)` / `or`: skip so the walk always terminates
    return { op: "true" };
  }

  return parseOr();
}

// --- Leaf matching ---------------------------------------------------------

function unquote(value: string): string {
  let v = value;
  if (v.startsWith('"')) v = v.slice(1);
  if (v.endsWith('"')) v = v.slice(0, -1);
  return v;
}

// A note's searchable text: fields and tags, HTML stripped and diacritic-folded.
function haystack(note: DemoNote): string {
  const text = [note.front, note.back, ...note.tags]
    .join(" ")
    .replace(/<[^>]*>/g, " ");
  return foldText(text);
}

// Turn a folded pattern into a RegExp, treating `*` as "any run of characters"
// and escaping every other regex metacharacter. `anchored` full-matches (for
// qualifier values like `tag:parent::*`); otherwise it matches as a substring
// (for plain-text terms like `d*g`).
function wildcardRegExp(folded: string, anchored: boolean): RegExp {
  const body = folded
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(anchored ? `^${body}$` : body);
}

// Equality with `*` wildcard support, folded — for tag / note-type / deck values.
function matchesValue(candidate: string, value: string): boolean {
  const folded = foldText(value);
  const target = foldText(candidate);
  return folded.includes("*")
    ? wildcardRegExp(folded, true).test(target)
    : folded === target;
}

function deckMatches(note: DemoNote, value: string): boolean {
  // A wildcard (`French::*`, `Fr*`) full-matches the deck path; a plain name
  // matches the deck and its whole subtree, the way Anki's `deck:` scopes.
  if (value.includes("*")) {
    return wildcardRegExp(foldText(value), true).test(foldText(note.deckName));
  }
  return isCardInDeck(note.deckName, value);
}

function isMatches(note: DemoNote, state: string): boolean {
  // A suspended card leaves the new/learn/review/due queues, so those exclude
  // it — only `is:suspended` matches it, mirroring real Anki.
  switch (state) {
    case "new":
      return !note.suspended && note.state === "new";
    case "learn":
      return !note.suspended && note.state === "learn";
    case "review":
      return !note.suspended && note.state === "review";
    case "due":
      // Waiting to be reviewed — anything not yet finished or suspended, which
      // mirrors how the demo's due counts are derived (see mock-anki isDue).
      return !note.suspended && note.state !== "done";
    case "suspended":
      return note.suspended;
    default:
      // `buried` (no buried state in the demo) and any unknown state.
      return false;
  }
}

// Substring match against a note's fields+tags, with `*` wildcards, folded.
function textMatch(note: DemoNote, raw: string): boolean {
  const needle = foldText(unquote(raw));
  if (needle === "") return true;
  return needle.includes("*")
    ? wildcardRegExp(needle, false).test(haystack(note))
    : haystack(note).includes(needle);
}

function leafMatches(note: DemoNote, term: string): boolean {
  const colon = term.indexOf(":");
  if (colon > 0) {
    const name = term.slice(0, colon).toLowerCase();
    const value = unquote(term.slice(colon + 1));
    switch (name) {
      case "deck":
        return deckMatches(note, value);
      case "tag":
        return value.toLowerCase() === "none"
          ? note.tags.length === 0
          : note.tags.some((t) => matchesValue(t, value));
      case "is":
        return isMatches(note, value.toLowerCase());
      case "note":
        return matchesValue(note.modelName, value);
    }
    // An unhandled qualifier — a field search (`front:hello`) or an operator we
    // can't evaluate (`prop:`, `added:`, …). Approximate with a text match on the
    // value, so `front:perro` still finds a note whose Front is "el perro". Also
    // try the whole term, so a plain word that merely contains a colon (a URL, a
    // "3:4" ratio) still matches literally rather than being read as a field.
    return textMatch(note, value) || textMatch(note, term);
  }
  return textMatch(note, term);
}

function evaluate(node: Node, note: DemoNote): boolean {
  switch (node.op) {
    case "true":
      return true;
    case "leaf":
      return leafMatches(note, node.text);
    case "not":
      return !evaluate(node.a, note);
    case "and":
      return evaluate(node.a, note) && evaluate(node.b, note);
    case "or":
      return evaluate(node.a, note) || evaluate(node.b, note);
  }
}

/** The notes in `notes` that satisfy the (subset) Anki search `query`. */
export function notesMatchingSearch(
  notes: DemoNote[],
  query: string | undefined,
): DemoNote[] {
  const ast = parse(lex(query ?? ""));
  return notes.filter((n) => evaluate(ast, n));
}
