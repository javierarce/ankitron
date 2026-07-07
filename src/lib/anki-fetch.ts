import { AnkiResponse, DeckStats, DueCounts, StudyStats } from "./types";

/** True when running inside Tauri's webview. */
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function ankiFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const body = { action, version: 6, params };

  // Marketing demo build (VITE_DEMO=1): route every call to an in-memory Anki
  // simulator so the real UI runs in a plain browser with no Anki/AnkiConnect.
  // The dynamic import keeps the mock and its fixtures out of the shipped app —
  // in a normal build VITE_DEMO is statically false and this branch is dropped.
  if (import.meta.env.VITE_DEMO) {
    const { mockAnki } = await import("./demo/mock-anki");
    return mockAnki(action, params) as Promise<T>;
  }

  if (isTauri) {
    // Use Tauri's invoke to bypass CORS — the Rust backend proxies to AnkiConnect.
    const { invoke } = await import("@tauri-apps/api/core");
    const data = (await invoke("anki_request", { body })) as AnkiResponse<T>;

    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  }

  // Browser dev: use the Vite proxy at /api/anki
  const response = await fetch("/api/anki", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: AnkiResponse<T> = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

/**
 * Trigger a sync with AnkiWeb. Throws on failure (no AnkiWeb account
 * configured, network down); callers own how visibly to surface that — the
 * launch sync shows a corner pill, the Settings button shows inline text.
 */
export async function syncCollection(): Promise<void> {
  await ankiFetch("sync");
}

/**
 * Ask Anki to reload the collection, rebuilding its scheduler queues. Needed
 * after writes that bypass the scheduler with raw SQL (changeDeck) so an
 * active reviewer doesn't keep serving a moved card. Best-effort: failures
 * are swallowed, since the queues catch up on the next natural rebuild.
 */
export async function reloadCollection(): Promise<void> {
  await ankiFetch("reloadCollection").catch(() => {});
}

/**
 * Fetch due counts for a single deck. AnkiConnect keys getDeckStats by
 * deck ID and returns only the leaf name, so fetching per-deck avoids
 * ambiguity when mapping results back to full deck paths.
 */
export async function fetchDueCount(deckName: string): Promise<DueCounts> {
  try {
    const stats = await ankiFetch<Record<string, DeckStats>>("getDeckStats", {
      decks: [deckName],
    });
    const s = Object.values(stats)[0];
    return {
      new: s?.new_count ?? 0,
      learn: s?.learn_count ?? 0,
      review: s?.review_count ?? 0,
    };
  } catch {
    return { new: 0, learn: 0, review: 0 };
  }
}

// A `cardReviews` row: [id(ms), cardId, usn, ease, ivl, lastIvl, factor, durationMs, type].
// We only need the review id (index 0, for ordering) and its duration (index 7).
const REVIEW_ID = 0;
const REVIEW_DURATION_MS = 7;

/**
 * Today's study totals, matching Anki's main-screen line. The card count comes
 * straight from `getNumCardsReviewedToday` (which honours Anki's day-rollover
 * hour). For time, we can't ask AnkiConnect for "today's reviews" directly, so
 * we pull recent reviews per deck, take the most recent N (N = today's count —
 * reviews are chronological, so the newest N are exactly today's), and sum their
 * durations. The lookback window only needs to exceed one Anki day.
 */
export async function fetchTodayStudyStats(
  deckNames: string[],
): Promise<StudyStats> {
  const cards = await ankiFetch<number>("getNumCardsReviewedToday");
  if (cards <= 0) return { cards: 0, seconds: 0 };

  const lookbackMs = 2 * 24 * 60 * 60 * 1000; // two days, safely past any rollover
  const startID = Date.now() - lookbackMs;

  const perDeck = await Promise.all(
    deckNames.map((deck) =>
      ankiFetch<number[][]>("cardReviews", { deck, startID }).catch(() => []),
    ),
  );

  const recent = perDeck
    .flat()
    .sort((a, b) => b[REVIEW_ID] - a[REVIEW_ID])
    .slice(0, cards);
  const totalMs = recent.reduce((sum, r) => sum + (r[REVIEW_DURATION_MS] ?? 0), 0);

  return { cards, seconds: totalMs / 1000 };
}

/**
 * Number of notes in each deck, including its subdecks (Anki's `deck:` search
 * matches descendants). We count notes — not cards — so this matches the
 * deck-detail page, which lists one row per note: the count on the deck list
 * agrees with what you see after opening the deck. (Cards are reserved for
 * scheduling/study, where the unit genuinely is the card.) There's no bulk
 * per-deck note count, so this is one `findNotes` per deck; the Decks page
 * fetches it off its critical path (see decks.tsx) to stay instant.
 */
export async function fetchAllNoteCounts(
  deckNames: string[],
): Promise<Record<string, number>> {
  const results = await Promise.all(
    deckNames.map(async (deck) => ({ deck, count: await fetchNoteCount(deck) })),
  );
  const counts: Record<string, number> = {};
  for (const { deck, count } of results) {
    counts[deck] = count;
  }
  return counts;
}

/**
 * Notes in a single deck, including its subdecks (`deck:` matches descendants).
 * Returns 0 on failure so a count never blocks or breaks the caller. Used both
 * by the bulk count above and, on demand, by the delete-deck confirmation when
 * it opens before the bulk counts have loaded.
 */
export async function fetchNoteCount(deckName: string): Promise<number> {
  try {
    const ids = await ankiFetch<number[]>("findNotes", {
      query: `deck:"${deckName}"`,
    });
    return ids.length;
  } catch {
    return 0;
  }
}

/**
 * True when the whole collection holds no cards at all. Anki always ships an
 * empty "Default" deck, so "the user has no decks" never really happens — a
 * brand-new user has one empty deck instead. This is only called when nothing
 * is due, so it tells that genuinely empty collection apart from a user who has
 * simply finished everything for now. Any failure resolves to `false` so a
 * transient error never masquerades as "empty" and hides real decks behind the
 * onboarding screen.
 */
export async function isCollectionEmpty(): Promise<boolean> {
  try {
    const ids = await ankiFetch<number[]>("findNotes", { query: "deck:*" });
    return ids.length === 0;
  } catch {
    return false;
  }
}

/**
 * Due counts for many decks in a single round trip. getDeckStats accepts every
 * deck at once and returns a map keyed by deck id; each entry's `name` is only
 * the leaf, so we resolve ids back to full deck paths via deckNamesAndIds. This
 * replaces a per-deck fan-out — since AnkiConnect serialises requests on Anki's
 * main thread, that grew linearly with the number of decks; this stays at two
 * requests no matter how many decks (or subdecks) exist.
 */
export async function fetchAllDueCounts(
  deckNames: string[],
  // By default a failed stats request resolves to all-zero counts so callers
  // that just render badges don't blank their page. Pass throwOnError when the
  // caller needs to tell a genuine "everything is at zero" apart from a fetch
  // failure (the Decks page gates its Study action on this distinction).
  options?: { throwOnError?: boolean },
): Promise<Record<string, DueCounts>> {
  // Zero-initialise so a missing entry (or an outright failure) leaves the deck
  // list intact with blank counts rather than dropping rows.
  const counts: Record<string, DueCounts> = {};
  for (const deck of deckNames) {
    counts[deck] = { new: 0, learn: 0, review: 0 };
  }

  try {
    const [stats, namesAndIds] = await Promise.all([
      ankiFetch<Record<string, DeckStats>>("getDeckStats", {
        decks: deckNames,
      }),
      ankiFetch<Record<string, number>>("deckNamesAndIds"),
    ]);

    // getDeckStats keys by deck id and only gives the leaf name; invert
    // deckNamesAndIds (fullName -> id) to recover each entry's full path.
    const nameById = new Map<number, string>();
    for (const [name, id] of Object.entries(namesAndIds)) {
      nameById.set(id, name);
    }

    for (const s of Object.values(stats)) {
      const name = nameById.get(s.deck_id);
      if (name && name in counts) {
        counts[name] = {
          new: s.new_count ?? 0,
          learn: s.learn_count ?? 0,
          review: s.review_count ?? 0,
        };
      }
    }
  } catch (err) {
    // Let opt-in callers distinguish failure from a real all-zero result;
    // otherwise keep the zero-initialised counts so a stats failure doesn't
    // blank the page.
    if (options?.throwOnError) throw err;
  }

  return counts;
}
