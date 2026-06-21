import { useEffect, useState, type ReactNode } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { UpdateContext } from "@/components/update-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Owns app-update state: the pending update and whether the install dialog is
 * open. Two ways an update arrives here:
 *
 *  - On launch, we check() in the background. Finding one does *not* open
 *    anything — it just surfaces an <UpdateBadge /> in the header, so the check
 *    never interrupts what the user is doing.
 *  - The Settings "Check for updates" button runs its own check() and calls
 *    presentUpdate(). That's a deliberate user action, so we open the install
 *    dialog straight away.
 *
 * Either way the install/relaunch flow lives in one place (<UpdatePrompt />).
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Background check on launch — surfaces the badge, never auto-opens.
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (!found || cancelled) return;
        setUpdate(found);
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

  return (
    <UpdateContext.Provider
      value={{
        update,
        isDialogOpen,
        openDialog: () => setIsDialogOpen(true),
        closeDialog: () => setIsDialogOpen(false),
        presentUpdate: (found) => {
          setUpdate(found);
          setIsDialogOpen(true);
        },
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}
