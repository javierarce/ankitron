import type { ExportedNote } from "./import-export";
import { stripSoundTags } from "./audio";
import { CLOZE_RE, clozeParts } from "./cloze";
import { isClozeNote } from "./note-fields";

/** The front and back HTML to show when previewing a note before import. */
export interface CardFaces {
  front: string;
  back: string;
}

/** Replace every cloze deletion with a blank (or its hint) — the question side.
 * Uses Anki's `.cloze` class so it picks up the app's existing styling. */
export function blankCloze(html: string): string {
  return html.replace(CLOZE_RE, (_, inner: string) => {
    const { hint } = clozeParts(inner);
    return `<span class="cloze">[${hint || "..."}]</span>`;
  });
}

/** Reveal every cloze deletion's answer — the answer side. */
export function revealCloze(html: string): string {
  return html.replace(CLOZE_RE, (_, inner: string) => {
    const { answer } = clozeParts(inner);
    return `<span class="cloze">${answer}</span>`;
  });
}

/** [sound:…] tags are placeholders Anki's renderer turns into play buttons; the
 * raw field would otherwise show them as literal text. Audio preview is out of
 * scope here, so drop them. */
function stripSounds(html: string): string {
  return stripSoundTags(html).trim();
}

/**
 * Derive the front/back faces to preview for a note that hasn't been imported
 * yet — we only have its raw `fields` (flat strings, no `order`), so front/back
 * are picked by name convention rather than Anki's field order:
 *
 * - Cloze notes blank their `Text` on the front and reveal it (plus `Back
 *   Extra`) on the back.
 * - Otherwise the `Front`/`Back` fields are used when present; failing that
 *   (custom note types) the first field is the front and the rest are the back,
 *   so nothing renders empty.
 */
export function exportedNoteFaces(note: ExportedNote): CardFaces {
  const f = note.fields;
  if (isClozeNote(note)) {
    const text = f.Text ?? "";
    const extra = stripSounds(f["Back Extra"] ?? "");
    const back = revealCloze(text) + (extra ? `<hr>${extra}` : "");
    return { front: stripSounds(blankCloze(text)), back: stripSounds(back) };
  }

  const keys = Object.keys(f);
  const frontKey = "Front" in f ? "Front" : keys[0];
  const backKeys =
    "Back" in f && "Front" in f
      ? ["Back"]
      : keys.filter((k) => k !== frontKey);
  const front = frontKey ? f[frontKey] ?? "" : "";
  const back = backKeys
    .map((k) => f[k] ?? "")
    .filter((v) => v.trim() !== "")
    .join("<hr>");
  return { front: stripSounds(front), back: stripSounds(back) };
}
