import { useEffect, useState } from "react";
import { useUpdate } from "@/components/update-context";

type Phase = "available" | "installing" | "error";

/**
 * The install dialog for a pending update. It only renders once opened (from
 * the <UpdateBadge /> in the header) — the launch check lives in
 * <UpdateProvider /> and no longer pops this up on its own. On confirm:
 * download + install, stop the Anki we spawned cleanly, then relaunch.
 *
 * Deliberately a React modal rather than a native dialog: window.confirm()
 * doesn't work in the webview, and the dialog plugin's ask() depends on a
 * brittle JS↔native label round-trip. A modal we render ourselves has
 * unambiguous buttons and lets us show install errors inline instead of
 * failing silently.
 */
export function UpdatePrompt() {
  const { update, isDialogOpen, closeDialog } = useUpdate();
  const [phase, setPhase] = useState<Phase>("available");
  const [errMsg, setErrMsg] = useState("");

  // Close and reset to the offer view, so a prior install error doesn't linger
  // when the user taps the badge to reopen the dialog.
  function dismiss() {
    closeDialog();
    setPhase("available");
  }

  // While the dialog is up, lock the page behind it so the scroll wheel only
  // scrolls the release notes (which have their own overflow) instead of the
  // content showing through the backdrop.
  useEffect(() => {
    if (!isDialogOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isDialogOpen]);

  // Esc closes the dialog — but not mid-install, where the buttons are disabled
  // too, since you can't cancel a download/relaunch partway through.
  useEffect(() => {
    if (!isDialogOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "installing") {
        closeDialog();
        setPhase("available");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDialogOpen, phase, closeDialog]);

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

  if (!isDialogOpen || !update) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        {phase === "error" ? (
          <>
            <h3 className="mb-2 text-lg font-semibold">Update failed</h3>
            <p className="mb-4 break-words text-sm text-red-500">{errMsg}</p>
            <div className="flex justify-end">
              <button
                onClick={dismiss}
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
              AnkiTron {update.version} is available (you have{" "}
              {update.currentVersion}).
            </p>
            {update.body ? (
              <div className="mb-4 max-h-48 overflow-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-foreground/10 bg-foreground/5 p-3 text-sm text-foreground/70">
                {update.body}
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                onClick={dismiss}
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
