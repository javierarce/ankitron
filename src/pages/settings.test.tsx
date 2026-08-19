// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { SyncContextValue } from "@/lib/sync-context";
import { describeSyncFailure } from "@/lib/sync-error";

// Settings drives sync through the provider now, so mock the context: `sync` is
// a spy we can assert on, and `value` is mutated per test to stage a status.
const mock = vi.hoisted(() => {
  const sync = vi.fn();
  const reconnect = vi.fn();
  const value = {
    status: "idle",
    failure: null,
    syncedAt: 0,
    refreshedAt: 0,
    sync,
    reconnect,
    refresh: () => {},
    noteSyncAttempt: () => {},
    pageLoading: false,
    registerPageLoad: () => () => {},
  } as SyncContextValue;
  return { sync, reconnect, value };
});
vi.mock("@/lib/sync-context", () => ({ useSync: () => mock.value }));

// Sections that aren't under test pull in theme, update and ElevenLabs config —
// stub them down to what the Sync row needs.
vi.mock("@/lib/theme-context", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("@/components/update-context", () => ({
  useUpdate: () => ({
    update: null,
    openDialog: vi.fn(),
    presentUpdate: vi.fn(),
  }),
}));
vi.mock("@/components/elevenlabs-settings", () => ({
  ElevenLabsSettings: () => null,
}));

import { SettingsPage } from "./settings";

beforeEach(() => {
  mock.sync.mockClear();
  mock.reconnect.mockClear();
  // Reset to a clean idle state; individual tests stage what they need.
  Object.assign(mock.value, {
    status: "idle",
    failure: null,
    syncedAt: 0,
  });
});

afterEach(cleanup);

function renderAt(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/settings", state }]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage sync", () => {
  it("auto-runs a sync through the provider when arriving from the pill", async () => {
    renderAt({ syncOnArrive: true });

    // The arrival flag drives the provider's sync (which clears the corner pill
    // and bumps syncedAt) — not a detached local sync.
    await waitFor(() => expect(mock.sync).toHaveBeenCalledTimes(1));
  });

  it("shows the failure reason inline from the provider's failure", () => {
    mock.value.status = "error";
    mock.value.failure = describeSyncFailure(
      new Error("Sync status 2 not one of [0, 1]"),
    );

    renderAt();

    expect(screen.getByText(/A full sync is required/)).toBeTruthy();
    // A normal visit (no arrival flag) must not kick off a sync.
    expect(mock.sync).not.toHaveBeenCalled();
  });

  it("keeps an unrecognised failure's raw text as a secondary line", () => {
    mock.value.status = "error";
    mock.value.failure = describeSyncFailure(new Error("weird backend blowup"));

    renderAt();

    expect(screen.getByText("Anki couldn't finish the sync.")).toBeTruthy();
    expect(screen.getByText("weird backend blowup")).toBeTruthy();
  });

  it("offers a reconnect (not a plain retry) when Anki is what went away", async () => {
    const user = userEvent.setup();
    mock.value.status = "error";
    // Exactly what the Tauri proxy rejects with when Anki has quit.
    mock.value.failure = describeSyncFailure(
      "AnkiConnect request failed: error sending request for url (http://127.0.0.1:8765/)",
    );

    renderAt();

    // The raw transport text never reaches the user.
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(screen.getByText(/Ankitron can't reach Anki/)).toBeTruthy();

    // Retrying a sync against an Anki that isn't running would just fail the
    // same way; the button restarts Anki first.
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mock.reconnect).toHaveBeenCalledTimes(1);
    expect(mock.sync).not.toHaveBeenCalled();
  });

  it("reconnects rather than plain-syncing when arriving from the pill with Anki down", async () => {
    mock.value.status = "error";
    mock.value.failure = describeSyncFailure("AnkiConnect request failed: …");

    renderAt({ syncOnArrive: true });

    await waitFor(() => expect(mock.reconnect).toHaveBeenCalledTimes(1));
    expect(mock.sync).not.toHaveBeenCalled();
  });

  it("does not auto-sync on a normal visit", () => {
    renderAt();

    expect(mock.sync).not.toHaveBeenCalled();
  });
});
