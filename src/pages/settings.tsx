import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme, type Theme } from "@/lib/theme-context";
import { useUpdate } from "@/components/update-context";
import { ElevenLabsSettings } from "@/components/elevenlabs-settings";
import { isExperimentalEnabled, setExperimentalEnabled } from "@/lib/experimental";
import { useSync } from "@/lib/sync-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type CheckState = "idle" | "checking" | "uptodate" | "error";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { update, openDialog, presentUpdate } = useUpdate();
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<CheckState>("idle");
  const [checkError, setCheckError] = useState("");
  const [experimental, setExperimental] = useState(isExperimentalEnabled);
  const location = useLocation();
  const navigate = useNavigate();
  // Drive sync through the provider so the whole app stays in one state: a
  // manual sync here clears the corner "Sync failed" pill on success and bumps
  // syncedAt so pages refetch — the same handler that owns the launch sync.
  const { status: syncStatus, error: syncError, syncedAt, sync } = useSync();

  function toggleExperimental() {
    const next = !experimental;
    setExperimental(next);
    setExperimentalEnabled(next);
  }

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setVersion).catch(() => {})
    );
  }, []);

  // The corner "Sync failed" pill can't say *why* sync failed, so tapping it
  // brings the user here and asks us to run a sync — the failure (or success,
  // if they've since fixed it) then shows inline in the Sync row below. Clear
  // the navigation flag first so a refresh or back-navigation doesn't re-fire.
  useEffect(() => {
    const state = location.state as { syncOnArrive?: boolean } | null;
    if (!state?.syncOnArrive) return;
    navigate(".", { replace: true, state: null });
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per arrival with the flag; sync is a stable provider callback and re-firing on it would loop the sync
  }, [location.state]);

  async function checkForUpdates() {
    if (!isTauri || check === "checking") return;
    setCheck("checking");
    setCheckError("");
    try {
      const { check: checkUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await checkUpdate();
      if (found) {
        // Hand the update to the provider, which records it (so this button
        // becomes "Update now") and opens the install dialog.
        presentUpdate(found);
        setCheck("idle");
      } else {
        setCheck("uptodate");
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
      setCheck("error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>

      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">Appearance</p>
            <p className="text-xs text-foreground/50">
              Use a light or dark theme, or follow your system.
            </p>
          </div>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            aria-label="Theme"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">Sync</p>
            <p className="text-xs text-foreground/50">
              Ankitron syncs on launch and after studying.
              {syncStatus === "idle" && syncedAt > 0 && " — synced"}
              {syncStatus === "error" && ` — ${syncError}`}
            </p>
          </div>
          <button
            onClick={sync}
            disabled={syncStatus === "syncing"}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-60"
          >
            {syncStatus === "syncing" ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {isTauri && (
          <div className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="text-sm font-medium">Updates</p>
              <p className="text-xs text-foreground/50">
                {version ? `Ankitron ${version}` : "Ankitron"}
                {check === "uptodate" && " — you're up to date"}
                {check === "error" && ` — ${checkError}`}
              </p>
            </div>
            <button
              onClick={update ? openDialog : checkForUpdates}
              disabled={check === "checking"}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-60"
            >
              {update
                ? "Update now"
                : check === "checking"
                  ? "Checking…"
                  : "Check for updates"}
            </button>
          </div>
        )}
      </div>

      {/* The ElevenLabs commands only exist in the desktop app. */}
      {isTauri && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/40">
            Experimental
          </h2>
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={experimental}
              onChange={toggleExperimental}
              className="accent-foreground"
            />
            Enable experimental features
          </label>
          <p className="mt-1 text-xs text-foreground/50">
            In development — these features may change or be removed.
          </p>
          {experimental && (
            <div className="mt-2 divide-y divide-border">
              <ElevenLabsSettings />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
