// Card flags. Anki tags a card with one of seven colours (or none) — a manual,
// per-card marker independent of scheduling. The rest of the app is note-level
// (the list shows notes, suspension toggles a note's cards together), so flags
// are applied that way too: flagging writes every card of the note, and a
// note's shown flag is the flag of its first flagged card. For the common
// single-card note this is exactly Anki's per-card behaviour.
//
// AnkiConnect has no dedicated flag action and cardsInfo doesn't return the
// flag, so writing goes through setSpecificValueOfCard (the raw `flags` column,
// which isn't a guarded key) and reading is inferred from `flag:N` searches.

import { ankiFetch } from "./anki-fetch";
import { findCardIds } from "./cards";

export interface FlagDef {
  /** Anki's flag number, 1–7 (0 is "no flag"). */
  value: number;
  /** Anki's colour name for the flag. */
  name: string;
  /** The flag colour, as Anki renders it (same in light and dark). */
  color: string;
}

/**
 * The seven flags, in Anki's order and colours (`_color-palette.scss`). The
 * value is the number stored in the card's `flags` byte and used by `flag:N`
 * searches; 0 means unflagged and isn't listed here.
 */
export const FLAGS: readonly FlagDef[] = [
  { value: 1, name: "Red", color: "#ef4444" },
  { value: 2, name: "Orange", color: "#fb923c" },
  { value: 3, name: "Green", color: "#4ade80" },
  { value: 4, name: "Blue", color: "#3b82f6" },
  { value: 5, name: "Pink", color: "#e879f9" },
  { value: 6, name: "Turquoise", color: "#2dd4bf" },
  { value: 7, name: "Purple", color: "#a855f7" },
];

/** The colour for a flag number, or null for "no flag" (0) / an unknown value. */
export function flagColor(flag: number): string | null {
  return FLAGS.find((f) => f.value === flag)?.color ?? null;
}

/**
 * The flag on each of `cardIds`, as a `cardId → flag` map (absent = unflagged).
 * There's no "read this card's flag" action, so this runs one `flag:N` search
 * per colour and keeps the hits that fall in `cardIds`. The searches are
 * collection-wide (scoping by `cid:` would break the demo's search subset), so
 * this is cheap only while the number of flagged cards stays modest — true for
 * a manual marker. Returns an empty map for an empty input without any I/O.
 */
export async function fetchCardFlags(
  cardIds: number[],
): Promise<Map<number, number>> {
  const flags = new Map<number, number>();
  if (cardIds.length === 0) return flags;
  const wanted = new Set(cardIds);
  const perFlag = await Promise.all(
    FLAGS.map((f) =>
      findCardIds(`flag:${f.value}`).then((ids) => [f.value, ids] as const),
    ),
  );
  for (const [value, ids] of perFlag) {
    for (const id of ids) if (wanted.has(id)) flags.set(id, value);
  }
  return flags;
}

/**
 * Set (or clear, with 0) the flag on every card in `cardIds`. Writes one card
 * at a time — setSpecificValueOfCard takes a single card — and in parallel, so
 * a whole note's cards flip together. `flags` is a card column, so the value
 * must be the integer 0–7: setSpecificValueOfCard setattr's it onto the card
 * and Anki flushes that through a protobuf `uint32 flags` field, which rejects
 * a string — sending "3" makes the write fail (or silently no-op), leaving the
 * old flag in place. So pass the number, not its string form.
 */
export async function setNoteFlag(
  cardIds: number[],
  flag: number,
): Promise<void> {
  await Promise.all(
    cardIds.map((card) =>
      ankiFetch("setSpecificValueOfCard", {
        card,
        keys: ["flags"],
        newValues: [flag],
      }),
    ),
  );
}
