import { useEffect, useState } from "react";
import { DeckList } from "@/components/deck-list";
import { FullScreenSpinner } from "@/components/full-screen-spinner";
import { CenteredSpinner, Spinner } from "@/components/spinner";
import { StudySummary } from "@/components/study-summary";
import { useSync } from "@/lib/sync-context";
import {
  ankiFetch,
  fetchAllDueCounts,
  fetchTodayStudyStats,
} from "@/lib/anki-fetch";
import type { DueCounts, StudyStats } from "@/lib/types";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The first home load of a session happens during app startup, right after the
// layout's "Starting Anki…" spinner — so it reuses that same full-screen
// spinner to read as one continuous launch. Later visits to this tab use a
// lightweight in-content spinner instead of re-covering the whole app chrome.
let hasLoadedOnce = false;

export function HomePage() {
  const [decks, setDecks] = useState<string[]>([]);
  const [dueCounts, setDueCounts] = useState<Record<string, DueCounts>>({});
  const [studyStats, setStudyStats] = useState<StudyStats | null>(null);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFirstLoad] = useState(() => !hasLoadedOnce);
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
        const deckNames = await ankiFetch<string[]>("deckNames");
        if (cancelled) return;
        setDecks(deckNames);

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

          const counts = await fetchAllDueCounts(deckNames);
          if (cancelled) return;
          setDueCounts(counts);
        }
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
    // so no spinner) to pick up cards pulled from AnkiWeb.
  }, [syncedAt]);

  if (loading) {
    // Boot load: keep the launch spinner up. Later visits: a small in-content
    // spinner so the tab doesn't blank out the whole app on every navigation.
    return isFirstLoad ? (
      <FullScreenSpinner label="Starting Anki…" />
    ) : (
      <CenteredSpinner />
    );
  }

  if (hasError) return <AnkiNotConnected />;
  return (
    <>
      <DeckList decks={decks} dueCounts={dueCounts} />
      <StudySummary stats={studyStats} />
    </>
  );
}

function AnkiNotConnected() {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    // Anki may have been closed after startup — ask the backend to (re)launch
    // it headless, then reload the app now that it should be reachable.
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ensure_anki");
      } catch (err) {
        console.error("Could not start Anki:", err);
      }
    }
    window.location.reload();
  }

  // Full-screen overlay so the header (nav, sync) is covered and inert while
  // disconnected, and the message stays centered.
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8 text-red-500"
          aria-hidden="true"
        >
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold">Anki isn&apos;t connected</h2>
      <p className="mt-2 text-sm text-foreground/60">
        Ankitron can&apos;t reach Anki right now.
      </p>
      <button
        onClick={retry}
        disabled={retrying}
        className="mt-8 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {retrying ? (
          <Spinner size="sm" tone="inverted" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        )}
        {retrying ? "Reconnecting…" : "Try again"}
      </button>
    </div>
  );
}
