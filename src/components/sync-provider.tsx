import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { syncCollection } from "@/lib/anki-fetch";
import { Spinner } from "@/components/spinner";
import { SyncContext, type SyncStatus } from "@/lib/sync-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Set the first time a sync succeeds on this install. We use it to tell a
// configured user (whose sync genuinely failed and should see it) apart from a
// brand-new one who never set up AnkiWeb — the launch sync always fails for the
// latter, and a red "Sync failed" pill on an untouched app is alarming and
// unactionable. Persisted so the distinction survives restarts.
const SYNCED_BEFORE_KEY = "ankitron.hasSyncedBefore";

function readSyncedBefore(): boolean {
  try {
    return localStorage.getItem(SYNCED_BEFORE_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState(0);
  const [pageLoads, setPageLoads] = useState(0);
  const [syncedBefore, setSyncedBefore] = useState(readSyncedBefore);
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
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("syncing");
    setError("");
    try {
      await syncCollection();
      setSyncedAt((n) => n + 1);
      setStatus("idle");
      // Record that sync works here, so future failures are shown as real.
      try {
        localStorage.setItem(SYNCED_BEFORE_KEY, "1");
      } catch {
        // Best-effort — a blocked localStorage just means we re-suppress the
        // error pill next launch, which is the safe direction.
      }
      setSyncedBefore(true);
    } catch (e) {
      // Sync failure is non-fatal — the app keeps working on local data. The
      // indicator surfaces the failure so it isn't silently swallowed; the
      // message is kept for the Settings row, which has room to show why.
      console.warn("Sync failed:", e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Kick off the launch sync once the provider mounts (it only mounts after
  // Anki is reachable, see Layout). Only auto-sync inside Tauri — in browser
  // dev / the demo build there's no Anki to reach; a manual sync() (e.g. the
  // Settings button) still runs everywhere.
  useEffect(() => {
    if (!isTauri) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync() owns the status state machine; the "syncing" transition belongs with the request it starts
    sync();
  }, [sync]);

  const pageLoading = pageLoads > 0;

  return (
    <SyncContext.Provider
      value={{ status, error, syncedAt, sync, pageLoading, registerPageLoad }}
    >
      {children}
      <SyncIndicator
        status={status}
        pageLoading={pageLoading}
        syncedBefore={syncedBefore}
      />
    </SyncContext.Provider>
  );
}

function SyncIndicator({
  status,
  pageLoading,
  syncedBefore,
}: {
  status: SyncStatus;
  pageLoading: boolean;
  syncedBefore: boolean;
}) {
  const navigate = useNavigate();

  if (status === "idle") return null;

  // A page's own blocking spinner already says "loading" — don't stack the
  // corner spinner on top of it. Failures still surface, since the page spinner
  // can't communicate a failed sync.
  if (status === "syncing" && pageLoading) return null;

  // Suppress the failure pill until sync has worked at least once here: on a
  // fresh, never-configured install the launch sync always fails, and a red
  // alert the user can do nothing about just sours first impressions.
  if (status === "error" && !syncedBefore) return null;

  if (status === "error") {
    return (
      <button
        // The pill has no room to explain the failure; send the user to
        // Settings, which re-runs the sync and shows the reason inline.
        onClick={() => navigate("/settings", { state: { syncOnArrive: true } })}
        title="Sync failed — open Settings for details"
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
