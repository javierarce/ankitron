/**
 * Parsing helpers for the GitHub-issue-style search box. The box accepts Anki's
 * search syntax (https://docs.ankiweb.net/searching.html); these helpers power
 * the autocomplete dropdown and decide when a query is rich enough that it must
 * be executed by Anki's backend rather than the in-memory substring filter.
 *
 * Everything here is pure and unit-tested — the React component (search-input)
 * owns the caret, focus, and keyboard handling, and calls into this module.
 */

/** A qualifier offered in the dropdown, e.g. `deck:` or `is:`. */
export interface Qualifier {
  /** The keyword before the colon, e.g. "deck". */
  name: string;
  /** One-line hint shown beside the qualifier in the menu. */
  description: string;
  /**
   * Where to source value suggestions once the user has typed `name:`.
   * "none" qualifiers (added, prop, …) still route to the backend and still
   * highlight, but we have no concrete value list to offer.
   */
  valueKind: "deck" | "tag" | "is" | "note" | "none";
}

/**
 * The qualifiers we surface, in menu order. Field searches (`front:` …) and the
 * advanced operators (`re:`, `nid:` …) still work because the whole query is
 * handed to Anki — they're just omitted from autocomplete to keep the menu
 * focused on what's broadly useful. `flag:` is intentionally absent until the
 * app grows a flag feature.
 */
export const QUALIFIERS: Qualifier[] = [
  { name: "deck", description: "Notes in a deck", valueKind: "deck" },
  { name: "tag", description: "Notes with a tag", valueKind: "tag" },
  { name: "is", description: "Card state", valueKind: "is" },
  { name: "note", description: "Note type", valueKind: "note" },
  { name: "added", description: "Added in the last N days", valueKind: "none" },
  { name: "edited", description: "Edited in the last N days", valueKind: "none" },
  { name: "rated", description: "Reviewed in the last N days", valueKind: "none" },
  { name: "prop", description: "Property: ivl, due, reps, ease…", valueKind: "none" },
];

/** Fixed value set for `is:`. */
export const IS_VALUES: { value: string; description: string }[] = [
  { value: "new", description: "Unstudied cards" },
  { value: "due", description: "Waiting to be reviewed" },
  { value: "review", description: "In review" },
  { value: "learn", description: "Being learned" },
  { value: "suspended", description: "Suspended cards" },
  { value: "buried", description: "Buried cards" },
];

/** Live data the dropdown draws on for value completions. */
export interface SuggestionSources {
  decks: string[];
  tags: string[];
  models: string[];
  /** Whether any note in scope is untagged, gating the `tag:none` suggestion. */
  hasUntagged?: boolean;
}

/** A single dropdown entry. */
export interface Suggestion {
  /** Primary text, e.g. "deck:" or "French::Verbs" or "is:new". */
  display: string;
  /**
   * Stable id the UI maps to an icon: a qualifier name ("deck", "tag", …) for
   * keyword rows and qualifier values, or an `is:` state ("new", "due", …) so
   * those rows can each carry their own icon.
   */
  iconKey: string;
  /** Secondary hint shown muted to the right. */
  detail?: string;
  /** Full token text to substitute for the active token (prefix + quoting). */
  apply: string;
  /**
   * True when this only completes the qualifier keyword (e.g. `deck:`), so the
   * caller should keep the menu open to offer values next. False for a terminal
   * completion, after which we append a space and close.
   */
  continues: boolean;
}

/** A whitespace-delimited token with its position in the source string. */
export interface Token {
  start: number;
  end: number;
  text: string;
}

const QUALIFIER_BY_NAME = new Map(QUALIFIERS.map((q) => [q.name, q]));
const MAX_SUGGESTIONS = 8;

/**
 * Split a query into tokens. Whitespace separates tokens except inside double
 * quotes, so `deck:"My Deck"` stays a single token.
 */
export function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;
    const start = i;
    let inQuote = false;
    while (i < query.length) {
      const c = query[i];
      if (c === '"') inQuote = !inQuote;
      else if (/\s/.test(c) && !inQuote) break;
      i++;
    }
    tokens.push({ start, end: i, text: query.slice(start, i) });
  }
  return tokens;
}

/**
 * The token the caret sits in (or touches the edge of). When the caret is in
 * whitespace, returns an empty token at the caret — the cue to offer the full
 * qualifier list for a fresh term.
 */
export function activeTokenAt(query: string, cursor: number): Token {
  for (const t of tokenize(query)) {
    if (cursor >= t.start && cursor <= t.end) return t;
  }
  return { start: cursor, end: cursor, text: "" };
}

/** Peel a leading `-` (negation) off so the rest can be classified. */
function splitPrefix(text: string): { prefix: string; body: string } {
  return text.startsWith("-")
    ? { prefix: "-", body: text.slice(1) }
    : { prefix: "", body: text };
}

/** Strip surrounding double quotes for case-insensitive matching. */
function unquote(value: string): string {
  let v = value;
  if (v.startsWith('"')) v = v.slice(1);
  if (v.endsWith('"')) v = v.slice(0, -1);
  return v;
}

/** Format a `name:value` token, quoting the value when it contains whitespace. */
function formatValue(prefix: string, name: string, value: string): string {
  const needsQuote = /\s/.test(value);
  return `${prefix}${name}:${needsQuote ? `"${value}"` : value}`;
}

/**
 * Every value already used for `qualifier` anywhere in the query, lowercased,
 * so the menu can omit values you've already applied — re-offering `tag:A` when
 * the query already has it (or while you've just typed it) is a no-op.
 */
export function appliedValues(query: string, qualifier: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(query)) {
    const { body } = splitPrefix(t.text);
    const colon = body.indexOf(":");
    if (colon <= 0) continue;
    if (body.slice(0, colon).toLowerCase() !== qualifier) continue;
    out.add(unquote(body.slice(colon + 1)).toLowerCase());
  }
  return out;
}

/**
 * Suggestions for the active token. Returns an empty list (so the caller shows
 * no menu) when the token is plain text that matches no qualifier, or sits on a
 * free-form/unknown qualifier value — i.e. there's nothing concrete to offer.
 *
 * `query` (the full input) lets value suggestions skip anything already applied
 * for the same qualifier elsewhere in the query, and the value just typed.
 */
export function suggestionsFor(
  token: Token,
  sources: SuggestionSources,
  query: string = "",
  limit: number = MAX_SUGGESTIONS,
): Suggestion[] {
  const { prefix, body } = splitPrefix(token.text);
  const colon = body.indexOf(":");

  // No colon yet: complete the qualifier keyword. Match by prefix so typing
  // plain words that aren't qualifier prefixes simply shows nothing.
  if (colon === -1) {
    const q = body.toLowerCase();
    return QUALIFIERS.filter((qual) => qual.name.startsWith(q))
      .slice(0, limit)
      .map((qual) => ({
        display: `${qual.name}:`,
        iconKey: qual.name,
        detail: qual.description,
        apply: `${prefix}${qual.name}:`,
        continues: true,
      }));
  }

  // Past the colon: complete the value for a known qualifier.
  const name = body.slice(0, colon).toLowerCase();
  const qualifier = QUALIFIER_BY_NAME.get(name);
  if (!qualifier || qualifier.valueKind === "none") return [];

  const typed = unquote(body.slice(colon + 1)).toLowerCase();
  // Offer a value if it matches what's typed and isn't already in the query
  // (applied elsewhere, or exactly what's been typed so far).
  const applied = appliedValues(query, name);
  const usable = (value: string) =>
    value.toLowerCase().includes(typed) && !applied.has(value.toLowerCase());

  if (qualifier.valueKind === "is") {
    return IS_VALUES.filter((v) => usable(v.value))
      .slice(0, limit)
      .map((v) => ({
        display: `is:${v.value}`,
        iconKey: v.value,
        detail: v.description,
        apply: `${prefix}is:${v.value}`,
        continues: false,
      }));
  }

  const pool =
    qualifier.valueKind === "deck"
      ? sources.decks
      : qualifier.valueKind === "tag"
        ? // `tag:none` only makes sense while some note in scope is untagged.
          [...(sources.hasUntagged ? ["none"] : []), ...sources.tags]
        : sources.models;

  return pool
    .filter(usable)
    .slice(0, limit)
    .map((value) => ({
      display: `${name}:${value}`,
      iconKey: name,
      apply: formatValue(prefix, name, value),
      continues: false,
    }));
}

/**
 * Replace the active token with a chosen suggestion, returning the new query
 * and caret offset. Terminal completions get a trailing space so the user can
 * keep typing; keyword completions (`deck:`) leave the caret right after the
 * colon so values appear next.
 */
export function applySuggestion(
  query: string,
  token: Token,
  suggestion: Suggestion,
): { query: string; cursor: number } {
  const before = query.slice(0, token.start);
  const after = query.slice(token.end);
  const trailing = suggestion.continues || after.startsWith(" ") ? "" : " ";
  const insert = suggestion.apply + trailing;
  return { query: before + insert + after, cursor: before.length + insert.length };
}

/**
 * Whether a query uses anything beyond plain words — qualifiers, negation,
 * grouping, phrases, wildcards, or `or`. Such queries are executed by Anki's
 * backend (which understands the full syntax); plain text stays on the instant
 * in-memory substring filter.
 */
const QUALIFIER_NAMES = new Set(QUALIFIERS.map((q) => q.name));

/**
 * Drop tokens that are a known qualifier with no value yet (`tag:`, `deck:`,
 * `is:` …) — a half-typed command that can't usefully match anything. So while
 * the autocomplete menu is open, the results behind it stay put instead of
 * blanking, and a finished part of a multi-term query still applies
 * (`is:due tag:` → `is:due`).
 *
 * Only our own qualifiers are stripped: an empty *field* search like `front:`
 * (notes with an empty Front) is a real Anki query, so unknown/field
 * qualifiers are left untouched.
 */
export function effectiveQuery(query: string): string {
  return tokenize(query)
    .filter((t) => {
      const { body } = splitPrefix(t.text);
      const colon = body.indexOf(":");
      if (colon <= 0) return true; // plain term, or a leading-colon oddity
      const name = body.slice(0, colon).toLowerCase();
      if (!QUALIFIER_NAMES.has(name)) return true; // field/unknown: keep as-is
      return unquote(body.slice(colon + 1)) !== "";
    })
    .map((t) => t.text)
    .join(" ");
}

/**
 * The query that defines the *context* for autocompleting the token under the
 * caret: every other token, normalised via effectiveQuery. Lets suggestions
 * narrow to the notes matching the rest of the query — co-occurring tags, decks
 * still in play — without the half-typed token filtering itself out of its own
 * results (a partial `tag:ani` would otherwise match no notes, so offer none).
 */
export function contextQuery(query: string, cursor: number): string {
  const active = activeTokenAt(query, cursor);
  const rest = tokenize(query)
    .filter((t) => t.start !== active.start || t.end !== active.end)
    .map((t) => t.text)
    .join(" ");
  return effectiveQuery(rest);
}

/** A run of the query string, tagged so the overlay can colour it. */
export type HighlightKind = "plain" | "qualifier" | "value";
export interface HighlightSegment {
  text: string;
  kind: HighlightKind;
}

/**
 * Split the raw query into coloured runs for the highlight overlay, covering
 * every character (whitespace included) so it lines up with the input behind
 * it. A recognised `qualifier:value` (e.g. `deck:French`, `is:due`) splits into
 * a muted keyword and a highlighted value — like GitHub tinting `label:bug`.
 * Plain words, half-typed qualifiers, and unknown/field qualifiers stay plain.
 */
export function highlightQuery(query: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let pos = 0;
  for (const t of tokenize(query)) {
    if (t.start > pos) {
      segments.push({ text: query.slice(pos, t.start), kind: "plain" });
    }
    const { prefix, body } = splitPrefix(t.text);
    const colon = body.indexOf(":");
    const name = colon > 0 ? body.slice(0, colon).toLowerCase() : "";
    const valued =
      colon > 0 &&
      QUALIFIER_NAMES.has(name) &&
      unquote(body.slice(colon + 1)) !== "";
    if (valued) {
      const split = prefix.length + colon + 1; // through the colon
      segments.push({ text: t.text.slice(0, split), kind: "qualifier" });
      segments.push({ text: t.text.slice(split), kind: "value" });
    } else {
      segments.push({ text: t.text, kind: "plain" });
    }
    pos = t.end;
  }
  if (pos < query.length) {
    segments.push({ text: query.slice(pos), kind: "plain" });
  }
  return segments;
}

export function hasOperators(query: string): boolean {
  for (const t of tokenize(query)) {
    if (t.text.startsWith("-")) return true;
    if (/[()*"]/.test(t.text)) return true;
    const { body } = splitPrefix(t.text);
    if (body.indexOf(":") > 0) return true;
    if (body.toLowerCase() === "or") return true;
  }
  return false;
}
