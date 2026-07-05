// Cloze-deletion parsing, shared by the card list, the editor form, the import
// preview, and the source-view highlighter. Anki's syntax is {{c1::answer}} or
// {{c1::answer::hint}}.

/** Every complete cloze deletion, capturing its `answer` or `answer::hint`
 * body. Global — meant for replace()/matchAll(), not a bare test(). */
export const CLOZE_RE = /\{\{c\d+::(.*?)\}\}/g;

/** Non-global twin of CLOZE_RE, safe for test(). */
const CLOZE_TEST_RE = new RegExp(CLOZE_RE.source);

/** Just the opening `{{cN::` marker — for spotting cloze-flavoured content
 * (e.g. a custom note type's field) without requiring the closing braces. */
export const CLOZE_OPEN_RE = /\{\{c\d+::/;

/** CLOZE_RE's shape as a composable source string, with the body widened to
 * span newlines — the source-view highlighter scans pretty-printed text where
 * a cloze can wrap across lines. */
export const CLOZE_MULTILINE_SOURCE = String.raw`\{\{c\d+::[\s\S]*?\}\}`;

/** Split a cloze body `answer` or `answer::hint` into its parts. */
export function clozeParts(inner: string): { answer: string; hint?: string } {
  const i = inner.lastIndexOf("::");
  if (i === -1) return { answer: inner };
  return { answer: inner.slice(0, i), hint: inner.slice(i + 2) };
}

/** Replace every cloze deletion with its answer (dropping any hint), leaving
 * the surrounding text untouched — for plain-text previews. */
export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_, inner: string) => clozeParts(inner).answer);
}

/** Whether the HTML contains at least one complete cloze deletion. Tags are
 * stripped first so markup inside the braces can't hide the pattern. */
export function hasClozePattern(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "");
  return CLOZE_TEST_RE.test(text);
}
