import { useEffect, useState } from "react";
import { AnkiConnectionError } from "@/components/anki-connection-error";
import { DeckList } from "@/components/deck-list";
import { EmptyCollection } from "@/components/empty-collection";
import { FullScreenSpinner } from "@/components/full-screen-spinner";
import { CenteredSpinner } from "@/components/spinner";
import { StudySummary } from "@/components/study-summary";
import { useSync } from "@/lib/sync-context";
import {
  fetchAllDueCounts,
  fetchTodayStudyStats,
  isCollectionEmpty,
} from "@/lib/anki-fetch";
import { fetchDeckNames } from "@/lib/decks";
import type { DueCounts, StudyStats } from "@/lib/types";

// The first home load of a session happens during app startup, right after the
// layout's "Starting Anki…" spinner — so it reuses that same full-screen
// spinner to read as one continuous launch. Later visits to this tab use a
// lightweight in-content spinner instead of re-covering the whole app chrome.
let hasLoadedOnce = false;

// Once we've seen the collection hold any cards, it won't spontaneously empty
// again, so we stop probing for emptiness for the rest of the session. Without
// this, the collection-wide findNotes lookup would re-fire on every "nothing
// due" state — a routine daily condition for any caught-up user — and on every
// background-sync reload, turning a one-time new-user cost into a recurring one.
let collectionKnownNonEmpty = false;

export function HomePage() {
  const [decks, setDecks] = useState<string[]>([]);
  const [dueCounts, setDueCounts] = useState<Record<string, DueCounts>>({});
  const [studyStats, setStudyStats] = useState<StudyStats | null>(null);
  const [collectionEmpty, setCollectionEmpty] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFirstLoad] = useState(() => !hasLoadedOnce);
  // Bumped after the user adds their first card from the onboarding screen, to
  // re-run the loader and drop out of the empty state into the deck view.
  const [refreshTick, setRefreshTick] = useState(0);
  const { syncedAt, registerPageLoad } = useSync();

  // While our blocking spinner is up, suppress the corner sync indicator so the
  // two never show at once.
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const deckNames = await fetchDeckNames();
        if (cancelled) return;
        setDecks(deckNames);

        let counts: Record<string, DueCounts> = {};
        if (deckNames.length > 0) {
          // Today's-study summary is non-critical and still costs one
          // cardReviews request per deck — the last per-deck fan-out. Fire it
          // off but don't await it, so the spinner clears as soon as the
          // (batched) due counts land; the footer pops in when it's ready.
          fetchTodayStudyStats(deckNames)
            .then((stats) => {
              if (!cancelled) setStudyStats(stats);
            })
            .catch(() => {
              // Non-critical — leave the summary hidden rather than failing.
            });

          counts = await fetchAllDueCounts(deckNames);
          if (cancelled) return;
          setDueCounts(counts);
        }

        // A brand-new user has nothing due, which the deck list would show as
        // the discouraging "all caught up". Distinguishing an empty collection
        // needs a collection-wide lookup, so only pay for it while the
        // collection might still be empty: skip entirely once we've seen it
        // hold cards (see collectionKnownNonEmpty). Any due card also proves it
        // isn't empty, so we only probe when nothing is due.
        let empty = false;
        if (!collectionKnownNonEmpty) {
          const nothingDue = Object.values(counts).every(
            (c) => c.new + c.learn + c.review === 0
          );
          empty = nothingDue ? await isCollectionEmpty() : false;
          if (cancelled) return;
          if (!empty) collectionKnownNonEmpty = true;
        }
        setCollectionEmpty(empty);

        // Clear any earlier failure so a recovered background refetch (on a
        // syncedAt bump) drops the "Anki isn't connected" overlay.
        if (!cancelled) setHasError(false);
      } catch (err) {
        console.error("Home page load failed:", err);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
        hasLoadedOnce = true;
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Re-run silently when a sync completes (`loading` is already false by then,
    // so no spinner) to pick up cards pulled from AnkiWeb, or when the user adds
    // their first card from the onboarding screen (refreshTick).
  }, [syncedAt, refreshTick]);

  if (loading) {
    // Boot load: keep the launch spinner up. Later visits: a small in-content
    // spinner so the tab doesn't blank out the whole app on every navigation.
    return isFirstLoad ? (
      <FullScreenSpinner label="Starting Anki…" />
    ) : (
      <CenteredSpinner />
    );
  }

  // A fetch failed after startup — most often the user quit Anki mid-session.
  if (hasError) return <AnkiConnectionError reason="unreachable" />;
  if (collectionEmpty) {
    // Add the first card to Anki's stock "Default" deck when it's present,
    // falling back to whatever deck exists so this never targets a missing one.
    const firstCardDeck = decks.includes("Default")
      ? "Default"
      : decks[0] ?? "Default";
    return (
      <EmptyCollection
        deckName={firstCardDeck}
        decks={decks}
        onCardAdded={() => setRefreshTick((t) => t + 1)}
      />
    );
  }
  return (
    <>
      <DeckList decks={decks} dueCounts={dueCounts} />
      <StudySummary stats={studyStats} />
    </>
  );
}
