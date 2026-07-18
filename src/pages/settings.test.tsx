// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SyncContextValue } from "@/lib/sync-context";

// Settings drives sync through the provider now, so mock the context: `sync` is
// a spy we can assert on, and `value` is mutated per test to stage a status.
const mock = vi.hoisted(() => {
  const sync = vi.fn();
  const value = {
    status: "idle",
    error: "",
    syncedAt: 0,
    sync,
    pageLoading: false,
    registerPageLoad: () => () => {},
  } as SyncContextValue;
  return { sync, value };
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
  // Reset to a clean idle state; individual tests stage what they need.
  Object.assign(mock.value, {
    status: "idle",
    error: "",
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

  it("shows the failure reason inline from the provider's error", () => {
    mock.value.status = "error";
    mock.value.error = "A full sync is required.";

    renderAt();

    expect(screen.getByText(/A full sync is required\./)).toBeTruthy();
    // A normal visit (no arrival flag) must not kick off a sync.
    expect(mock.sync).not.toHaveBeenCalled();
  });

  it("does not auto-sync on a normal visit", () => {
    renderAt();

    expect(mock.sync).not.toHaveBeenCalled();
  });
});
