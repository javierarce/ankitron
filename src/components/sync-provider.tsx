import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { syncCollection } from "@/lib/anki-fetch";
import { Spinner } from "@/components/spinner";
import { SyncContext, type SyncStatus } from "@/lib/sync-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// How long the app's data may sit untouched before coming back to the window
// refreshes it. Deliberately generous: a sync invalidates the Stats page's
// revlog cache (see lib/stats/cache.ts), so a short window would make routine
// app-switching throw away an expensive read for nothing. The case this exists
// for — the app left open overnight — clears it many times over.
const STALE_AFTER_MS = 30 * 60 * 1000;

// How often we check the clock ourselves, for the stretches where no focus
// event ever arrives (see the wake/rollover note in the listener below).
const STALE_POLL_MS = 60 * 1000;

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
 * `refreshedAt` bumps.
 *
 * It also owns the app's staleness policy. Pages fetch on mount and otherwise
 * only when told to, so an app left open overnight would sit on yesterday's
 * numbers — Anki's day rolls over at 4am and reviews done on the phone land on
 * AnkiWeb, with nothing to tell the app either happened. Coming back to the
 * window (or simply enough time passing) triggers a refresh.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [pageLoads, setPageLoads] = useState(0);
  const [syncedBefore, setSyncedBefore] = useState(readSyncedBefore);
  const inFlight = useRef(false);
  // When the last sync attempt finished, successful or not, as the clock reads
  // it — a failed attempt still means we just asked, so a broken connection
  // can't turn every focus event into another doomed request.
  const lastAttemptAt = useRef(0);

  const registerPageLoad = useCallback(() => {
    setPageLoads((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setPageLoads((n) => n - 1);
    };
  }, []);

  // Shared body of `sync` and `refresh`. They differ only in what happens when
  // the sync fails: a refresh still bumps `refreshedAt`, because the caller
  // wants current data and the most common staleness (the day rollover) is
  // local and owes nothing to AnkiWeb.
  const run = useCallback(async ({ refreshOnFailure = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("syncing");
    setError("");
    try {
      await syncCollection();
      setSyncedAt((n) => n + 1);
      setRefreshedAt((n) => n + 1);
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
      if (refreshOnFailure) setRefreshedAt((n) => n + 1);
    } finally {
      lastAttemptAt.current = Date.now();
      inFlight.current = false;
    }
  }, []);

  const sync = useCallback(() => void run(), [run]);
  const refresh = useCallback(() => void run({ refreshOnFailure: true }), [run]);
  const noteSyncAttempt = useCallback(() => {
    lastAttemptAt.current = Date.now();
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

  // Mid-review the study page runs its own sync when the session ends, and a
  // sync landing mid-session can reschedule the very cards the session is
  // holding. It doesn't read `refreshedAt` either, and leaving it remounts the
  // pages that do — so an auto-refresh there is all cost and no benefit.
  const location = useLocation();
  const studying = location.pathname.endsWith("/study");
  const studyingRef = useRef(studying);
  useEffect(() => {
    studyingRef.current = studying;
  }, [studying]);

  const refreshIfStale = useCallback(() => {
    if (!isTauri || inFlight.current || studyingRef.current) return;
    if (Date.now() - lastAttemptAt.current < STALE_AFTER_MS) return;
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri) return;

    const check = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    // Tauri's own focus event is the dependable one for a native window: the
    // DOM events above don't consistently fire in WKWebView when the OS window
    // is activated.
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) refreshIfStale();
        }),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Focus events only make the refresh prompt; the poll below still
        // catches staleness within the minute if the window API is missing.
      });

    // The window can also go a long time without ever losing focus. Left
    // frontmost when the machine sleeps, it wakes with no focus change at all;
    // sitting visible on a second monitor, it crosses the 4am rollover without
    // one either. So watch the clock too — `refreshIfStale` caps the cost at
    // one sync per STALE_AFTER_MS however often this fires.
    const timer = setInterval(check, STALE_POLL_MS);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      clearInterval(timer);
      unlisten?.();
    };
  }, [refreshIfStale]);

  const pageLoading = pageLoads > 0;

  // Memoised so navigating (which re-renders this provider, via useLocation
  // above) doesn't re-render every consumer in the app.
  const value = useMemo(
    () => ({
      status,
      error,
      syncedAt,
      refreshedAt,
      sync,
      refresh,
      noteSyncAttempt,
      pageLoading,
      registerPageLoad,
    }),
    [
      status,
      error,
      syncedAt,
      refreshedAt,
      sync,
      refresh,
      noteSyncAttempt,
      pageLoading,
      registerPageLoad,
    ],
  );

  return (
    <SyncContext.Provider value={value}>
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
