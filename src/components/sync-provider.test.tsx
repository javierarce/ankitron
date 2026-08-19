// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

// The provider only syncs inside Tauri (checked via __TAURI_INTERNALS__ at
// module load). Mark the env as Tauri before the module is imported, and give
// syncCollection a deferred result so tests can hold a sync in its "syncing"
// state.
const { syncCollection, controls } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const controls: { resolve?: () => void; reject?: (e: unknown) => void } = {};
  const syncCollection = vi.fn(
    () =>
      new Promise<void>((res, rej) => {
        controls.resolve = res;
        controls.reject = rej;
      }),
  );
  return { syncCollection, controls };
});
vi.mock("@/lib/anki-fetch", () => ({ syncCollection }));

// Restarting Anki is a backend call; the tests only care that it happens
// before the retry goes out.
const { ensureAnkiRunning } = vi.hoisted(() => ({
  ensureAnkiRunning: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/lib/anki-launch", () => ({ ensureAnkiRunning }));

// The provider subscribes to the native window's focus event. Stub the plugin:
// under jsdom the real one has no Tauri IPC to talk to, and the tests drive
// staleness through the DOM focus event and the clock instead.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => Promise.resolve(() => {}),
  }),
}));

import { SyncProvider } from "./sync-provider";
import { useSync } from "@/lib/sync-context";

// A consumer that surfaces syncedAt and can register/release a page load on
// demand, standing in for a page showing its blocking spinner.
// Reports the current route so tests can assert where the pill navigates. The
// pill's error path routes to /settings with a syncOnArrive flag in history state.
function LocationProbe() {
  const location = useLocation();
  const flagged = (location.state as { syncOnArrive?: boolean } | null)
    ?.syncOnArrive;
  return (
    <span data-testid="location">
      {location.pathname}
      {flagged ? ":syncOnArrive" : ""}
    </span>
  );
}

// The provider renders the corner pill, which navigates on click — so every
// render needs a router in the tree.
function renderWithRouter(ui: ReactNode, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );
}

function Consumer({ pageLoadAtFirst = false }: { pageLoadAtFirst?: boolean }) {
  const {
    syncedAt,
    refreshedAt,
    registerPageLoad,
    noteSyncAttempt,
    reconnect,
    refresh,
    failure,
  } = useSync();
  const [loading, setLoading] = useState(pageLoadAtFirst);
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);
  return (
    <div>
      <span data-testid="synced">{syncedAt}</span>
      <span data-testid="refreshed">{refreshedAt}</span>
      <span data-testid="failure">{failure?.kind ?? "none"}</span>
      <button onClick={() => setLoading(false)}>release</button>
      {/* Stands in for the study page reporting its end-of-session sync. */}
      <button onClick={noteSyncAttempt}>note sync</button>
      {/* Stands in for Settings' Reconnect button. */}
      <button onClick={reconnect}>reconnect</button>
      {/* Stands in for Cmd+R / the command palette's Refresh item. */}
      <button onClick={refresh}>refresh</button>
    </div>
  );
}

beforeEach(() => {
  syncCollection.mockClear();
  ensureAnkiRunning.mockClear();
  controls.resolve = undefined;
  controls.reject = undefined;
  // Node's own experimental localStorage global shadows jsdom's here and its
  // methods aren't functional, so give each test a real in-memory stand-in
  // (same approach as card-list.test.tsx).
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

// The failure pill is suppressed until a sync has succeeded on this install
// (a fresh, never-configured install always fails its launch sync — see
// SYNCED_BEFORE_KEY in sync-provider.tsx). Tests that assert the pill mark
// the install as previously synced first.
function markSyncedBefore() {
  localStorage.setItem("ankitron.hasSyncedBefore", "1");
}

afterEach(cleanup);

describe("SyncProvider", () => {
  it("syncs on mount and shows the corner indicator until it resolves", async () => {
    renderWithRouter(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    expect(syncCollection).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Syncing…")).toBeTruthy();
    expect(screen.getByTestId("synced").textContent).toBe("0");

    await act(async () => {
      controls.resolve?.();
    });

    await waitFor(() =>
      expect(screen.queryByText("Syncing…")).toBeNull(),
    );
    // syncedAt bumps so pages know to refetch.
    expect(screen.getByTestId("synced").textContent).toBe("1");
  });

  it("surfaces a failed sync and opens Settings when the pill is clicked", async () => {
    const user = userEvent.setup();
    markSyncedBefore();
    renderWithRouter(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      // What the Tauri proxy rejects with when Anki has quit — a bare string,
      // not an Error.
      controls.reject?.(
        "AnkiConnect request failed: error sending request for url (http://127.0.0.1:8765/)",
      );
    });

    // The pill names the problem rather than reciting the transport error.
    const pill = await screen.findByText("Anki isn't running");
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(syncCollection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location").textContent).toBe("/");

    // The pill can't explain the failure, so it routes to Settings (which
    // re-runs the sync there and shows the reason inline) rather than silently
    // retrying in place.
    await user.click(pill);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/settings:syncOnArrive",
      ),
    );
    expect(syncCollection).toHaveBeenCalledTimes(1);
  });

  it("restarts Anki before retrying, when Anki is what went away", async () => {
    markSyncedBefore();
    renderWithRouter(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      controls.reject?.("AnkiConnect request failed: error sending request");
    });
    expect(await screen.findByText("Anki isn't running")).toBeTruthy();

    // Retrying the request alone would fail identically — which is what
    // "pressing sync again does nothing" looked like. Anki comes back up first.
    await act(async () => {
      screen.getByText("reconnect").click();
    });
    expect(ensureAnkiRunning).toHaveBeenCalledTimes(1);
    expect(syncCollection).toHaveBeenCalledTimes(2);
    // The failure survives its own retry: Settings reads `failure.kind` to keep
    // the button saying "Reconnecting…" rather than reverting to "Syncing…"
    // halfway through the reconnect it started.
    expect(screen.getByTestId("failure").textContent).toBe("anki-unreachable");

    // The retry lands (after the pressed sync's minimum visible spell, which is
    // why this waits rather than asserting straight away).
    await act(async () => {
      controls.resolve?.();
    });
    await waitFor(() =>
      expect(screen.getByTestId("synced").textContent).toBe("1"),
    );
    expect(screen.queryByText("Anki isn't running")).toBeNull();
    // …and is dropped once a sync actually works.
    expect(screen.getByTestId("failure").textContent).toBe("none");
  });

  it("shows a pressed refresh working, even when the sync behind it fails at once", async () => {
    markSyncedBefore();
    renderWithRouter(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );
    await act(async () => {
      controls.resolve?.();
    });

    // Cmd+R and the palette's Refresh go through `refresh`, so they're presses
    // too: the attempt has to be visible before the failure lands, or a refresh
    // against a dead Anki looks as inert as the sync button used to.
    await act(async () => {
      screen.getByText("refresh").click();
    });
    expect(screen.getByText("Syncing…")).toBeTruthy();

    await act(async () => {
      controls.reject?.("AnkiConnect request failed: error sending request");
    });
    expect(screen.getByText("Syncing…")).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByText("Anki isn't running")).toBeTruthy(),
    );
    // Pages still re-read: the day may have rolled over regardless.
    expect(screen.getByTestId("refreshed").textContent).toBe("2");
  });

  it("hides the syncing indicator while a page shows its own spinner", async () => {
    renderWithRouter(
      <SyncProvider>
        <Consumer pageLoadAtFirst />
      </SyncProvider>,
    );

    // Sync is in flight, but the page's blocking spinner is up — no corner
    // spinner stacked on top.
    await waitFor(() => expect(syncCollection).toHaveBeenCalled());
    expect(screen.queryByText("Syncing…")).toBeNull();

    // Page finishes loading → the still-running sync now shows in the corner.
    await act(async () => {
      screen.getByText("release").click();
    });
    expect(await screen.findByText("Syncing…")).toBeTruthy();
  });

  it("still shows a sync failure even while a page is loading", async () => {
    markSyncedBefore();
    renderWithRouter(
      <SyncProvider>
        <Consumer pageLoadAtFirst />
      </SyncProvider>,
    );

    await act(async () => {
      controls.reject?.(new Error("offline"));
    });

    // Failures aren't suppressed — the page spinner can't communicate them.
    expect(await screen.findByText("AnkiWeb unreachable")).toBeTruthy();
  });
});

// The app left open overnight used to sit on yesterday's numbers: pages fetch
// on mount and nothing else told them the day had rolled over. These cover the
// staleness policy that fixes it.
describe("SyncProvider staleness refresh", () => {
  const STALE_AFTER_MS = 30 * 60 * 1000;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Mount, settle the launch sync, and hand back its result promise controls. */
  async function mountSynced(route = "/") {
    renderWithRouter(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
      route,
    );
    await act(async () => {
      controls.resolve?.();
    });
    expect(syncCollection).toHaveBeenCalledTimes(1);
  }

  it("refreshes once the data has gone stale, with no user input at all", async () => {
    await mountSynced();

    // Overnight: the machine sleeps, no focus event ever fires, and the window
    // is still frontmost on wake. The clock is the only signal there is.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 60_000);
    });
    expect(syncCollection).toHaveBeenCalledTimes(2);

    await act(async () => {
      controls.resolve?.();
    });
    // Pages refetch off refreshedAt, so the home screen picks up the new day.
    expect(screen.getByTestId("refreshed").textContent).toBe("2");
  });

  it("leaves fresh data alone when the window regains focus", async () => {
    await mountSynced();

    // Alt-tabbing away and back must not cost a sync — every one of them
    // throws away the Stats page's cached revlog read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(syncCollection).toHaveBeenCalledTimes(1);
  });

  it("refreshes on focus once the data is stale", async () => {
    await mountSynced();

    // Jump the clock without letting the poll fire, so this exercises the
    // focus path on its own.
    await act(async () => {
      vi.setSystemTime(Date.now() + STALE_AFTER_MS + 1000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(syncCollection).toHaveBeenCalledTimes(2);
  });

  it("still refetches pages when the catch-up sync fails", async () => {
    markSyncedBefore();
    await mountSynced();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 60_000);
    });
    await act(async () => {
      controls.reject?.(new Error("offline"));
    });

    // Being offline doesn't make yesterday's due counts correct — the day
    // rolled over locally — so pages re-read even though the sync failed. The
    // Stats cache key (syncedAt) stays put, since nothing new arrived.
    expect(screen.getByTestId("refreshed").textContent).toBe("2");
    expect(screen.getByTestId("synced").textContent).toBe("1");
  });

  it("counts a sync run outside the provider, so study's doesn't get doubled", async () => {
    await mountSynced();

    // A long session: study runs its own end-of-session sync and reports it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS - 60_000);
      screen.getByText("note sync").click();
    });

    // Leaving the session, the clock now reads from study's sync — not from
    // before the session — so no duplicate round trip lands on top of it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(syncCollection).toHaveBeenCalledTimes(1);

    // The threshold still applies from that point on.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS);
    });
    expect(syncCollection).toHaveBeenCalledTimes(2);
  });

  it("holds off while a study session is in progress", async () => {
    await mountSynced("/decks/Spanish/study");

    // A sync landing mid-review can reschedule the cards the session is
    // holding, and the study page doesn't read refreshedAt anyway.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 60_000);
    });
    expect(syncCollection).toHaveBeenCalledTimes(1);
  });
});
