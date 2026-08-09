// Leeches — the notes Anki has given up on — for the deck page's banner.
//
// Anki tags a card `leech` once it lapses past the deck's leech threshold, and
// re-fires every half-threshold lapses after that (its default leech action
// also suspends the card). The only thing it shows for this is a tooltip in the
// reviewer, which is easy to miss mid-session — hence the standing banner.
//
// The banner has no dismiss, and doesn't need one: `leech` is an ordinary tag,
// so dealing with a note and then clearing the tag off it (the bulk tag dialog,
// undoable) is what makes the notice go away. That gesture is also the honest
// one — if the note is still failing, Anki re-tags it at the next threshold
// crossing, so the reminder comes back off real review data rather than off a
// remembered dismissal.

export const LEECH_TAG = "leech";

/** The search that shows them, in the deck page's own query syntax. */
export const LEECH_QUERY = `tag:${LEECH_TAG}`;

/** A deck's leeches: how many, and how many of those Anki has parked. */
export interface LeechCount {
  total: number;
  /** Suspended by Anki's leech action — sitting out of study until dealt with. */
  suspended: number;
}

export function isLeech(note: { tags: string[] }): boolean {
  return note.tags.includes(LEECH_TAG);
}

export function countLeeches<T extends { tags: string[] }>(
  notes: T[],
  isNoteSuspended: (note: T) => boolean,
): LeechCount {
  let total = 0;
  let suspended = 0;
  for (const note of notes) {
    if (!isLeech(note)) continue;
    total++;
    if (isNoteSuspended(note)) suspended++;
  }
  return { total, suspended };
}

/**
 * Whether a query is already showing the leeches, so the banner can stand down
 * rather than announce what's on screen. Matches `tag:leech` as a whole token
 * (`tag:leeches` is a different tag) anywhere in the query.
 */
export function isLeechQuery(query: string): boolean {
  return /(^|[\s(])tag:leech(?=$|[\s)])/i.test(query);
}

/**
 * The banner's two lines. Suspended leeches are worth calling out separately:
 * they're not just hard, they've stopped coming up at all, so the deck is
 * quietly smaller than it looks.
 *
 * Kept short enough to sit on one line next to the count and the action.
 * "Suspended" goes unexplained on purpose — it's the same word the row menu and
 * the stats panel already use, so it doesn't need re-teaching here.
 */
export function leechSummary({ total, suspended }: LeechCount): {
  title: string;
  detail: string;
} {
  const title =
    total === 1 ? "1 note is a leech" : `${total} notes are leeches`;
  const forgetting =
    total === 1 ? "You keep forgetting it." : "You keep forgetting them.";
  if (suspended === 0) return { title, detail: forgetting };
  const parked =
    total === 1
      ? "It's suspended."
      : suspended === total
        ? "All are suspended."
        : suspended === 1
          ? "1 is suspended."
          : `${suspended} are suspended.`;
  return { title, detail: `${forgetting} ${parked}` };
}
