// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The provider only syncs inside Tauri (checked via __TAURI_INTERNALS__ at
// module load). Mark the env as Tauri before the module is imported, and give
// ankiFetch a deferred result so tests can hold a sync in its "syncing" state.
const { ankiFetch, controls } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const controls: { resolve?: () => void; reject?: (e: unknown) => void } = {};
  const ankiFetch = vi.fn(
    () =>
      new Promise<void>((res, rej) => {
        controls.resolve = res;
        controls.reject = rej;
      }),
  );
  return { ankiFetch, controls };
});
vi.mock("@/lib/anki-fetch", () => ({ ankiFetch }));

import { SyncProvider } from "./sync-provider";
import { useSync } from "@/lib/sync-context";

// A consumer that surfaces syncedAt and can register/release a page load on
// demand, standing in for a page showing its blocking spinner.
function Consumer({ pageLoadAtFirst = false }: { pageLoadAtFirst?: boolean }) {
  const { syncedAt, registerPageLoad } = useSync();
  const [loading, setLoading] = useState(pageLoadAtFirst);
  useEffect(() => {
    if (loading) return registerPageLoad();
  }, [loading, registerPageLoad]);
  return (
    <div>
      <span data-testid="synced">{syncedAt}</span>
      <button onClick={() => setLoading(false)}>release</button>
    </div>
  );
}

beforeEach(() => {
  ankiFetch.mockClear();
  controls.resolve = undefined;
  controls.reject = undefined;
});

afterEach(cleanup);

describe("SyncProvider", () => {
  it("syncs on mount and shows the corner indicator until it resolves", async () => {
    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    expect(ankiFetch).toHaveBeenCalledWith("sync");
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

  it("surfaces a failed sync and retries when the pill is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      controls.reject?.(new Error("offline"));
    });

    const pill = await screen.findByText("Sync failed");
    expect(ankiFetch).toHaveBeenCalledTimes(1);

    await user.click(pill);
    expect(ankiFetch).toHaveBeenCalledTimes(2);
    // A retry returns to the syncing state.
    expect(await screen.findByText("Syncing…")).toBeTruthy();
  });

  it("hides the syncing indicator while a page shows its own spinner", async () => {
    render(
      <SyncProvider>
        <Consumer pageLoadAtFirst />
      </SyncProvider>,
    );

    // Sync is in flight, but the page's blocking spinner is up — no corner
    // spinner stacked on top.
    await waitFor(() => expect(ankiFetch).toHaveBeenCalled());
    expect(screen.queryByText("Syncing…")).toBeNull();

    // Page finishes loading → the still-running sync now shows in the corner.
    await act(async () => {
      screen.getByText("release").click();
    });
    expect(await screen.findByText("Syncing…")).toBeTruthy();
  });

  it("still shows a sync failure even while a page is loading", async () => {
    render(
      <SyncProvider>
        <Consumer pageLoadAtFirst />
      </SyncProvider>,
    );

    await act(async () => {
      controls.reject?.(new Error("offline"));
    });

    // Failures aren't suppressed — the page spinner can't communicate them.
    expect(await screen.findByText("Sync failed")).toBeTruthy();
  });
});
