import { useEffect } from "react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Checks for an app update once on launch. If one is available, asks the user
 * to confirm, then downloads + installs it and relaunches the app.
 *
 * The check, download, and signature verification all happen in Rust (the
 * updater plugin), so the locked-down webview CSP doesn't affect it. No-op
 * outside the Tauri shell (e.g. the browser dev server).
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

        const ok = window.confirm(
          `AnkiTron ${update.version} is available (you have ${update.currentVersion}).\n\nDownload and install it now? The app will restart.`,
        );
        if (!ok) return;

        await update.downloadAndInstall();

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
