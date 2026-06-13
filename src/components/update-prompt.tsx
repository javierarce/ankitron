import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Phase = "idle" | "available" | "installing" | "error";

/**
 * On launch, checks for an app update. If one is available, shows a plain React
 * modal asking the user to install. On confirm: download + install, stop the
 * Anki we spawned cleanly, then relaunch.
 *
 * Deliberately a React modal rather than a native dialog: window.confirm()
 * doesn't work in the webview, and the dialog plugin's ask() depends on a
 * brittle JS↔native label round-trip. A modal we render ourselves has
 * unambiguous buttons and lets us show install errors inline instead of
 * failing silently.
 */
export function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (!found || cancelled) return;
        setUpdate(found);
        setPhase("available");
      } catch (err) {
        // Offline, no release yet, or a transient fetch error — never block
        // startup on the update check.
        console.warn("Update check failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The Settings "Check for updates" button does its own check() and hands
  // any found update here, so the install flow lives in one place.
  useEffect(() => {
    function onManual(e: Event) {
      const found = (e as CustomEvent<Update>).detail;
      if (found) {
        setUpdate(found);
        setPhase("available");
      }
    }
    window.addEventListener("update-available", onManual);
    return () => window.removeEventListener("update-available", onManual);
  }, []);

  // While the dialog is up, lock the page behind it so the scroll wheel only
  // scrolls the release notes (which have their own overflow) instead of the
  // content showing through the backdrop.
  useEffect(() => {
    if (phase === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  async function install() {
    if (!update) return;
    setPhase("installing");
    try {
      await update.downloadAndInstall();

      // Stop the Anki we spawned and wait for :8765 to clear, so the relaunched
      // app spawns a fresh instance instead of latching onto the dying one.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_anki_for_update");

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  if (phase === "idle") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        {phase === "error" ? (
          <>
            <h3 className="mb-2 text-lg font-semibold">Update failed</h3>
            <p className="mb-4 break-words text-sm text-red-500">{errMsg}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setPhase("idle")}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-lg font-semibold">Update available</h3>
            <p className="mb-3 text-sm text-foreground/70">
              AnkiTron {update?.version} is available (you have{" "}
              {update?.currentVersion}).
            </p>
            {update?.body ? (
              <div className="mb-4 max-h-48 overflow-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-foreground/10 bg-foreground/5 p-3 text-sm text-foreground/70">
                {update.body}
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPhase("idle")}
                disabled={phase === "installing"}
                className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground disabled:opacity-50"
              >
                Later
              </button>
              <button
                onClick={install}
                disabled={phase === "installing"}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                {phase === "installing" ? "Installing…" : "Install and restart"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
