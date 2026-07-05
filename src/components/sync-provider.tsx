import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import { Spinner } from "@/components/spinner";
import { SyncContext, type SyncStatus } from "@/lib/sync-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Owns the launch sync and exposes its status. The sync runs in the background
 * — the app is already interactive — instead of blocking startup behind a
 * full-screen spinner, so opening no longer waits on an AnkiWeb round-trip.
 * (Ankitron and Anki can't run at once, so a launch sync replaces the manual
 * Sync button.) Progress shows as a small corner indicator; pages refresh when
 * `syncedAt` bumps.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [syncedAt, setSyncedAt] = useState(0);
  const [pageLoads, setPageLoads] = useState(0);
  const inFlight = useRef(false);

  const registerPageLoad = useCallback(() => {
    setPageLoads((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setPageLoads((n) => n - 1);
    };
  }, []);

  const sync = useCallback(async () => {
    if (!isTauri || inFlight.current) return;
    inFlight.current = true;
    setStatus("syncing");
    try {
      await ankiFetch("sync");
      setSyncedAt((n) => n + 1);
      setStatus("idle");
    } catch (e) {
      // Sync failure is non-fatal — the app keeps working on local data. The
      // indicator surfaces the failure so it isn't silently swallowed.
      console.warn("Sync failed:", e);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Kick off the launch sync once the provider mounts (it only mounts after
  // Anki is reachable, see Layout).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync() owns the status state machine; the "syncing" transition belongs with the request it starts
    sync();
  }, [sync]);

  const pageLoading = pageLoads > 0;

  return (
    <SyncContext.Provider
      value={{ status, syncedAt, sync, pageLoading, registerPageLoad }}
    >
      {children}
      <SyncIndicator status={status} pageLoading={pageLoading} onRetry={sync} />
    </SyncContext.Provider>
  );
}

function SyncIndicator({
  status,
  pageLoading,
  onRetry,
}: {
  status: SyncStatus;
  pageLoading: boolean;
  onRetry: () => void;
}) {
  if (status === "idle") return null;

  // A page's own blocking spinner already says "loading" — don't stack the
  // corner spinner on top of it. Failures still surface, since the page spinner
  // can't communicate a failed sync.
  if (status === "syncing" && pageLoading) return null;

  if (status === "error") {
    return (
      <button
        onClick={onRetry}
        title="Sync failed — click to retry"
        className="app-no-drag fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-red-500 shadow-sm backdrop-blur transition hover:bg-foreground/5"
      >
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Sync failed
      </button>
    );
  }

  return (
    <div
      title="Syncing…"
      className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-foreground/50 shadow-sm backdrop-blur"
    >
      <Spinner size="xs" tone="muted" />
      Syncing…
    </div>
  );
}
