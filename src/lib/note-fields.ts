import type { NoteField } from "./types";

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
