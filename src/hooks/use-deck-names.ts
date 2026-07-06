import { useEffect, useState } from "react";
import { fetchDeckNames } from "@/lib/decks";

/**
 * The collection's deck names, fetched once on mount. `null` while loading so
 * callers can distinguish "not loaded yet" from "no decks"; failures resolve to
 * an empty list (callers render an empty picker rather than an error). Pass
 * `enabled: false` to skip the fetch entirely (e.g. a form state that never
 * shows the deck picker).
 */
export function useDeckNames({ enabled = true }: { enabled?: boolean } = {}):
  | string[]
  | null {
  const [decks, setDecks] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchDeckNames()
      .then((names) => {
        if (!cancelled) setDecks(names);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return decks;
}
