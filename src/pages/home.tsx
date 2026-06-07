import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DeckList } from "@/components/deck-list";
import { ankiFetch, fetchAllDueCounts } from "@/lib/anki-fetch";
import type { DueCounts } from "@/lib/types";

export function HomePage() {
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
      } catch (err) {
        console.error("Home page load failed:", err);
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

  if (hasError) return <AnkiNotConnected />;
  return <DeckList decks={decks} dueCounts={dueCounts} />;
}

function AnkiNotConnected() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
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
        This app talks to Anki through the AnkiConnect add-on on{" "}
        <code className="rounded bg-foreground/10 px-1 py-0.5 text-xs">
          localhost:8765
        </code>
        .
      </p>
      <ol className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-foreground/80">
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-medium">
            1
          </span>
          <span>Launch the Anki desktop app.</span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-medium">
            2
          </span>
          <span>
            Install the{" "}
            <a
              href="https://ankiweb.net/shared/info/2055492159"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              AnkiConnect
            </a>{" "}
            add-on (code <code className="text-xs">2055492159</code>) and
            restart Anki.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-medium">
            3
          </span>
          <span>Reload this page.</span>
        </li>
      </ol>
      <Link
        to="/"
        onClick={() => window.location.reload()}
        className="mt-8 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
      >
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
        Try again
      </Link>
    </div>
  );
}
