import { useEffect, useState } from "react";
import { AllDecksList } from "@/components/all-decks-list";
import { ankiFetch, fetchAllDueCounts } from "@/lib/anki-fetch";
import type { DueCounts } from "@/lib/types";

export function DecksPage() {
  const [decks, setDecks] = useState<string[]>([]);
  const [dueCounts, setDueCounts] = useState<Record<string, DueCounts>>({});
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const deckNames = await ankiFetch<string[]>("deckNames");
        if (cancelled) return;
        setDecks(deckNames);

        if (deckNames.length > 0) {
          const counts = await fetchAllDueCounts(deckNames);
          if (cancelled) return;
          setDueCounts(counts);
        }
      } catch {
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

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

  return <AllDecksList decks={decks} dueCounts={dueCounts} />;
}
