import { useEffect } from "react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Checks for an app update once on launch. If one is available, asks the user
 * (via a native dialog) to confirm, then downloads + installs it, tears down
 * the Anki instance we spawned, and relaunches.
 *
 * Why the native dialog and not window.confirm(): window.confirm() doesn't work
 * in the Tauri webview — without the dialog plugin it silently returns false (no
 * prompt at all), and with it, it's overridden to an async function that a plain
 * `if (confirm(...))` never awaits. The dialog plugin's ask() is the reliable,
 * awaitable path.
 *
 * Why stop_anki_for_update before relaunch: relaunch() kills the Anki process we
 * spawned, but the fresh process can latch onto the dying instance (it's briefly
 * still answering on :8765) and then skip spawning its own — leaving the app with
 * no Anki. Stopping it and waiting for the port to clear makes the restart spawn
 * a clean instance.
 */
export function useUpdater() {
  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;

        const { ask } = await import("@tauri-apps/plugin-dialog");
        const yes = await ask(
          `AnkiTron ${update.version} is available (you have ${update.currentVersion}).\n\nDownload and install it now? The app will restart.`,
          {
            title: "Update available",
            kind: "info",
            okLabel: "Install and restart",
            cancelLabel: "Later",
          },
        );
        if (!yes || cancelled) return;

        await update.downloadAndInstall();

        // Cleanly stop the Anki we spawned and wait for :8765 to clear, so the
        // relaunched app spawns a fresh instance instead of a dying one.
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_anki_for_update");

        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (err) {
        // Offline, no release yet, or a transient fetch error — never block
        // app startup on the update check.
        console.warn("Update check failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
