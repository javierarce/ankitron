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
   * Increments each time a sync completes successfully. Pages key their
   * background refetch off this so fresh data lands without a navigation.
   */
  syncedAt: number;
  /** Trigger a sync. No-op while one is already in flight. */
  sync: () => void;
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
  sync: () => {},
  pageLoading: false,
  registerPageLoad: () => () => {},
});

export function useSync() {
  return useContext(SyncContext);
}
