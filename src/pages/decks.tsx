import { useCallback, useEffect, useState } from "react";
import { AllDecksList } from "@/components/all-decks-list";
import { ankiFetch, fetchAllCardCounts } from "@/lib/anki-fetch";

export function DecksPage() {
  const [decks, setDecks] = useState<string[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const deckNames = await ankiFetch<string[]>("deckNames");
    const counts = deckNames.length
      ? await fetchAllCardCounts(deckNames)
      : {};
    return { deckNames, counts };
  }, []);

  // Used by the list to refresh after a change (e.g. a card added via the menu).
  const reload = useCallback(async () => {
    try {
      const { deckNames, counts } = await fetchData();
      setDecks(deckNames);
      setCardCounts(counts);
      setHasError(false);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { deckNames, counts } = await fetchData();
        if (cancelled) return;
        setDecks(deckNames);
        setCardCounts(counts);
        setHasError(false);
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
  }, [fetchData]);

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
    <AllDecksList decks={decks} cardCounts={cardCounts} onRefresh={reload} />
  );
}
