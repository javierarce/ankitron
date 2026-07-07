// Reduce a note field's HTML to plain text, for list rows, search haystacks,
// and confirmation messages.

import { stripSoundTags } from "./audio";

/** Decode HTML entities. Uses the browser's parser when available; the manual
 * fallback covers the common entities for non-DOM environments (tests). */
export function decodeHtml(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

/** Plain text of an HTML field: sound tags and markup dropped, entities
 * decoded, surrounding whitespace trimmed. */
export function stripHtml(html: string): string {
  return decodeHtml(stripSoundTags(html).replace(/<[^>]*>/g, "")).trim();
}

/** Clip text to `max` characters, appending an ellipsis when it was longer. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}
