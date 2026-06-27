import { useCallback, useEffect, useState } from "react";
import { AllDecksList } from "@/components/all-decks-list";
import { useSync } from "@/lib/sync-context";
import {
  ankiFetch,
  fetchAllDueCounts,
  fetchAllNoteCounts,
} from "@/lib/anki-fetch";
import type { DueCounts } from "@/lib/types";

export function DecksPage() {
  const [decks, setDecks] = useState<string[]>([]);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [dueCounts, setDueCounts] = useState<Record<string, DueCounts>>({});
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);
  const { syncedAt, registerPageLoad } = useSync();

  // While our blocking spinner is up, suppress the corner sync indicator so the
  // two never show at once.
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);

  // Used by the list to refresh after a change (e.g. a card added via the menu).
  // No spinner here (loading is already false), so it's fine to await counts.
  const reload = useCallback(async () => {
    try {
      const deckNames = await ankiFetch<string[]>("deckNames");
      setDecks(deckNames);
      setHasError(false);
      setNoteCounts(deckNames.length ? await fetchAllNoteCounts(deckNames) : {});
      // Due counts only gate the Study action; a failure here shouldn't blank
      // the decks list, and we must not leave every row showing all-zero (which
      // would wrongly disable Study everywhere) — clear them so Study stays
      // enabled until a later refresh succeeds.
      try {
        setDueCounts(
          deckNames.length
            ? await fetchAllDueCounts(deckNames, { throwOnError: true })
            : {},
        );
      } catch {
        setDueCounts({});
      }
    } catch {
      setHasError(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const deckNames = await ankiFetch<string[]>("deckNames");
        if (cancelled) return;
        setDecks(deckNames);
        setHasError(false);

        // Note counts need one findNotes request per deck, serialised on Anki's
        // main thread, so they can lag on a large collection. Show the list as
        // soon as the deck names land and fill counts in off the critical path;
        // rows show a placeholder until their count arrives.
        if (deckNames.length > 0) {
          fetchAllNoteCounts(deckNames)
            .then((counts) => {
              if (!cancelled) setNoteCounts(counts);
            })
            .catch(() => {
              // Counts are non-critical — leave the placeholders in place.
            });
          // Due counts only gate the row menu's Study action, so fetch them off
          // the critical path too; until they land, Study stays enabled. Opt
          // into throwOnError so a stats failure leaves dueCounts empty (Study
          // stays enabled) rather than all-zero (which would disable it on
          // every row).
          fetchAllDueCounts(deckNames, { throwOnError: true })
            .then((counts) => {
              if (!cancelled) setDueCounts(counts);
            })
            .catch(() => {
              // Non-critical — leave Study enabled.
              if (!cancelled) setDueCounts({});
            });
        }
      } catch {
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // Re-run silently when a sync completes (`loading` is already false by then,
    // so no spinner) to pick up changes pulled from AnkiWeb.
  }, [syncedAt]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
      </div>
    );
  }

  if (hasError) {
    return (
      <p className="text-foreground/60">
        Could not load decks. Make sure Anki is running.
      </p>
    );
  }

  return (
    <AllDecksList
      decks={decks}
      noteCounts={noteCounts}
      dueCounts={dueCounts}
      onRefresh={reload}
    />
  );
}
