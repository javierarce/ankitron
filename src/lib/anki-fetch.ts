import { clearStatsCache } from "./stats/cache";
import { FULL_SYNC_MESSAGE } from "./sync-error";
import { AnkiResponse, DeckStats, DueCounts } from "./types";

/** True when running inside Tauri's webview. */
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Actions that change what the Stats page reports: revlog rows (grading,
 * undo, deletion), a card's deck attribution (RevlogEntry.deck is the card's
 * CURRENT deck), or the due schedule the forecast queries. Any of these
 * succeeding drops the Stats caches (see stats/cache.ts).
 *
 * Invalidation lives here — the one chokepoint every write passes through —
 * rather than sprinkled over call sites, because the sprinkled version was
 * incomplete the day it was written: grading cleared the cache, deleting a
 * note did not. A new mutating action added to this file should be checked
 * against this set, which is still one place instead of N.
 */
const STATS_MUTATING = new Set([
  "guiAnswerCard",
  "guiUndo",
  "deleteNotes",
  "deleteDecks",
  "changeDeck",
  "suspend",
  "unsuspend",
  "importPackage",
  // Writes a manual revlog row (AnkiConnect passes log: true) and moves the
  // card back into the new queue, so both the revlog and the forecast shift.
  "forgetCards",
]);

export async function ankiFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const result = await ankiTransport<T>(action, params);
  // Only a SUCCESSFUL mutation invalidates — a rejected grade or failed
  // delete wrote nothing, so the cache is still right.
  if (STATS_MUTATING.has(action)) clearStatsCache();
  return result;
}

async function ankiTransport<T>(
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

/** One sub-action's outcome from `ankiMulti`. */
export type MultiOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Run many actions in a single request.
 *
 * AnkiConnect serialises every request on Anki's main thread, so a fan-out of N
 * calls costs N round trips and visibly stalls a page — batching 30 due-date
 * searches this way took them from ~770ms to ~50ms against a live collection.
 *
 * The envelope is the catch, and it's worth stating plainly because it's easy
 * to get wrong: `multi` wraps EACH sub-result in its own `{result, error}`,
 * exactly like a top-level response, and it does NOT reject when a sub-action
 * fails — the failure is reported in-band. Consuming the array as bare results
 * silently misreads every entry. This helper unwraps that once, so callers deal
 * in a tagged outcome instead.
 */
export async function ankiMulti<T>(
  actions: Array<{ action: string; params?: Record<string, unknown> }>,
): Promise<MultiOutcome<T>[]> {
  if (actions.length === 0) return [];

  const results = await ankiFetch<unknown[]>("multi", {
    actions: actions.map((a) => ({ ...a, version: 6 })),
  });

  // ankiFetch's invalidation only sees the outer "multi" verb, so mutating
  // SUB-actions have to be caught here or a future batched write would leave
  // the Stats cache stale — the same trap the demo mock's persistence check
  // has with its own MUTATING set.
  if (actions.some((a) => STATS_MUTATING.has(a.action))) clearStatsCache();

  return actions.map((_, i) => {
    const item = results[i];
    if (item && typeof item === "object" && "result" in item) {
      const envelope = item as { result: unknown; error?: unknown };
      if (envelope.error == null) return { ok: true, value: envelope.result as T };
      return { ok: false, error: String(envelope.error) };
    }
    return { ok: false, error: "Malformed response from Anki." };
  });
}

/**
 * AnkiConnect's `sync` action runs the collection sync itself and only accepts
 * an incremental result — ChangesRequired NO_CHANGES (0) or NORMAL_SYNC (1). If
 * AnkiWeb instead demands a one-way full sync (FULL_SYNC 2, FULL_DOWNLOAD 3,
 * FULL_UPLOAD 4 — after a schema bump, or when the two sides have diverged) it
 * gives up with "Sync status N not one of [0, 1]", because picking upload vs
 * download is a destructive choice the headless API can't make. Match that
 * message so we can replace it with FULL_SYNC_MESSAGE, which lives with the
 * rest of the sync copy in lib/sync-error.ts.
 */
const FULL_SYNC_ERROR = /Sync status \d+ not one of/i;

/**
 * Trigger a sync with AnkiWeb. Throws on failure (no AnkiWeb account
 * configured, network down); callers own how visibly to surface that — the
 * launch sync shows a corner pill, the Settings button shows inline text. A
 * "full sync required" refusal is rethrown with an actionable message, since
 * the raw AnkiConnect wording ("Sync status 2 not one of [0, 1]") is opaque.
 */
export async function syncCollection(): Promise<void> {
  try {
    await ankiFetch("sync");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (FULL_SYNC_ERROR.test(message)) {
      throw new Error(FULL_SYNC_MESSAGE, { cause: e });
    }
    throw e;
  }
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
