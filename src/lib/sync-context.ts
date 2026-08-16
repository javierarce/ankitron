import { createContext, useContext } from "react";

export type SyncStatus = "idle" | "syncing" | "error";

export interface SyncContextValue {
  status: SyncStatus;
  /**
   * The reason the last sync failed, for surfaces with room to show it (the
   * Settings sync row). Empty unless `status` is "error". The corner pill only
   * has room for "Sync failed", so it sends the user to Settings to read this.
   */
  error: string;
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
   * Re-read the app's data, syncing first when possible. Unlike `sync`, pages
   * refetch even if the sync itself fails — being offline doesn't make
   * yesterday's due counts correct. No-op while a sync is already in flight.
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
  error: "",
  syncedAt: 0,
  refreshedAt: 0,
  sync: () => {},
  refresh: () => {},
  noteSyncAttempt: () => {},
  pageLoading: false,
  registerPageLoad: () => () => {},
});

export function useSync() {
  return useContext(SyncContext);
}
