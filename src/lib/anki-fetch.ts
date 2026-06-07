import { AnkiResponse, DueCounts } from "./types";

/** True when running inside Tauri's webview. */
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function ankiFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const body = { action, version: 6, params };

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
 * Fetch due counts for a single deck. AnkiConnect keys getDeckStats by
 * deck ID and returns only the leaf name, so fetching per-deck avoids
 * ambiguity when mapping results back to full deck paths.
 */
export async function fetchDueCount(deckName: string): Promise<DueCounts> {
  try {
    const stats = await ankiFetch<
      Record<string, { new_count: number; learn_count: number; review_count: number }>
    >("getDeckStats", { decks: [deckName] });
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

/** Fetch due counts for multiple decks in parallel. */
export async function fetchAllDueCounts(
  deckNames: string[],
): Promise<Record<string, DueCounts>> {
  const results = await Promise.all(
    deckNames.map(async (deck) => ({ deck, due: await fetchDueCount(deck) })),
  );
  const counts: Record<string, DueCounts> = {};
  for (const { deck, due } of results) {
    counts[deck] = due;
  }
  return counts;
}
