import type { Note, NoteField } from "./types";
import { CLOZE_TYPED_MODEL } from "./cloze-typed-model";

/** Anki's built-in cloze model names. A note is cloze either because its model
 * is one of these or because it carries the cloze-defining `Text` field. */
export function isClozeModelName(modelName: string): boolean {
  return modelName === "Cloze" || modelName === CLOZE_TYPED_MODEL;
}

/**
 * Resolve a Basic note's front/back field names by Anki's field `order`, not by
 * object key position. The Tauri proxy round-trips AnkiConnect responses through
 * serde_json, which sorts object keys alphabetically — so {Front, Back} can
 * arrive as {Back, Front}. Ordering by `order` keeps reads and writes consistent
 * (otherwise editing a card swaps its front and back).
 */
export function basicFieldKeys(fields: Record<string, NoteField>): {
  frontKey: string;
  backKey: string;
} {
  const ordered = Object.entries(fields)
    .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
    .map(([name]) => name);
  return { frontKey: ordered[0] ?? "Front", backKey: ordered[1] ?? "Back" };
}

/** Field names in Anki's field `order`, not object-key order (the Tauri proxy
 * sorts keys alphabetically). Used to render every field of an arbitrary note
 * type in its real order. */
export function orderedFieldNames(
  fields: Record<string, NoteField>,
): string[] {
  return Object.entries(fields)
    .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
    .map(([name]) => name);
}

/**
 * A note is "cloze" if its model is one of Anki's cloze types, or it has the
 * cloze-defining `Text` field. These notes render Text/Back Extra rather than
 * a front/back pair. Only field *names* matter here, so this accepts both a
 * live Note and an ExportedNote (whose fields are flat strings).
 */
export function isClozeNote(note: {
  modelName: string;
  fields: Record<string, unknown>;
}): boolean {
  return isClozeModelName(note.modelName) || "Text" in note.fields;
}

/**
 * The two field values to show for a note in lists and previews, for ANY note
 * type. Cloze notes use Text/Back Extra; everything else falls back to the
 * first two fields by `order` — so decks built on custom note types (whose
 * fields aren't named Front/Back) still render instead of appearing empty.
 */
export function noteDisplayFields(note: Pick<Note, "modelName" | "fields">): {
  primary: string;
  secondary: string;
} {
  if (isClozeNote(note)) {
    return {
      primary: note.fields.Text?.value ?? "",
      secondary: note.fields["Back Extra"]?.value ?? "",
    };
  }
  const { frontKey, backKey } = basicFieldKeys(note.fields);
  return {
    primary: note.fields[frontKey]?.value ?? "",
    secondary: note.fields[backKey]?.value ?? "",
  };
}
