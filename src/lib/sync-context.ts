import { createContext, useContext } from "react";
import type { SyncFailure } from "@/lib/sync-error";

export type SyncStatus = "idle" | "syncing" | "error";

export interface SyncContextValue {
  status: SyncStatus;
  /**
   * Why the last sync failed, classified (see lib/sync-error.ts) so each
   * surface can show the part it has room for: the corner pill shows the short
   * label, the Settings row the full explanation and the matching fix.
   *
   * Set when an attempt fails and kept until a later one succeeds — so it
   * outlives the failure itself and is still readable while a retry is in
   * flight ("syncing"), which is how Settings knows the in-flight attempt is a
   * reconnect and keeps its button saying "Reconnecting…". Gate failure UI on
   * `status === "error"`, not on this being non-null, or a retry will render
   * the failure it's busy clearing.
   */
  failure: SyncFailure | null;
  /**
   * Increments each time a sync completes successfully — i.e. each time the
   * collection itself may have changed under us. The Stats page uses it as its
   * revlog cache key, so bumping it throws away an expensive read.
   */
  syncedAt: number;
  /**
   * Increments whenever pages should re-read their data: after a successful
   * sync, and after a refresh whose sync failed. Pages key their background
   * refetch off this rather than `syncedAt`, so an offline refresh still picks
   * up local changes (chiefly Anki's day rollover) without discarding caches
   * that only a real sync can invalidate.
   */
  refreshedAt: number;
  /** Trigger a sync. No-op while one is already in flight. */
  sync: () => void;
  /**
   * Restart Anki if it has quit, then sync. The fix offered when a sync fails
   * with `kind: "anki-unreachable"` — a plain retry against an Anki that isn't
   * there would only fail the same way.
   */
  reconnect: () => void;
  /**
   * Re-read the app's data, syncing first when possible. Unlike `sync`, pages
   * refetch even if the sync itself fails — being offline doesn't make
   * yesterday's due counts correct. No-op while a sync is already in flight.
   * This is the user-facing refresh (Cmd+R, the command palette); the
   * provider's own staleness catch-up doesn't come through here.
   */
  refresh: () => void;
  /**
   * Tell the staleness clock a sync just ran somewhere else. The study page
   * owns the end-of-session sync (it has its own inline retry, which the corner
   * pill would only duplicate). Refreshing is suppressed while a session is
   * open, so the clock is frozen for its whole duration: without this, any
   * session ending more than the staleness window after the last sync would
   * draw a second, pointless one right behind study's own.
   */
  noteSyncAttempt: () => void;
  /** True while at least one page is showing its own blocking load spinner. */
  pageLoading: boolean;
  /**
   * Register a page as showing its blocking load spinner. Call when that
   * spinner appears; invoke the returned cleanup when it's gone. Ref-counted,
   * so the corner sync indicator hides while any page is mid-load — you never
   * see two spinners at once.
   */
  registerPageLoad: () => () => void;
}

export const SyncContext = createContext<SyncContextValue>({
  status: "idle",
  failure: null,
  syncedAt: 0,
  refreshedAt: 0,
  sync: () => {},
  reconnect: () => {},
  refresh: () => {},
  noteSyncAttempt: () => {},
  pageLoading: false,
  registerPageLoad: () => () => {},
});

export function useSync() {
  return useContext(SyncContext);
}
