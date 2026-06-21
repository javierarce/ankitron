import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Gear } from "@phosphor-icons/react/dist/ssr/Gear";
import { AboutDialog } from "@/components/about-dialog";
import { Breadcrumb } from "@/components/breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { HeaderNav } from "@/components/header-nav";
import { UpdateBadge } from "@/components/update-badge";
import { UpdatePrompt } from "@/components/update-prompt";
import { ankiFetch } from "@/lib/anki-fetch";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function Layout() {
  const [ankiReady, setAnkiReady] = useState(!isTauri);
  const [startupMsg, setStartupMsg] = useState("Starting Anki…");

  useEffect(() => {
    // With the webview's native drag-drop disabled, the browser default for a
    // file dropped anywhere is to navigate to it — replacing the app with a
    // bare media/file viewer. Suppress that default window-wide. The editor's
    // own drop handler sits deeper in the DOM and fires first, so we don't stop
    // propagation — only the default navigation.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    document.documentElement.classList.add("tauri");
    import("@tauri-apps/plugin-os").then(({ platform }) => {
      if (platform() === "macos") {
        document.documentElement.classList.add("tauri-mac");
      }
    });

    // Wait for Anki, then pull from AnkiWeb before rendering any pages so the
    // app always opens on fresh data (Ankitron and Anki can't run at once, so
    // a launch sync replaces the manual Sync button). Sync failure never
    // blocks startup — we render regardless.
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("wait_for_anki").then(async (ok) => {
        if (ok) {
          setStartupMsg("Syncing…");
          try {
            await ankiFetch("sync");
          } catch (e) {
            console.warn("Startup sync failed:", e);
          }
        } else {
          console.warn("Anki did not start in time");
        }
        setAnkiReady(true);
      });
    });
  }, []);

  function handleDrag(e: React.MouseEvent) {
    // Only drag on primary button, single click (not double-click to maximize)
    if (!isTauri || e.buttons !== 1 || e.detail >= 2) return;
    // Don't drag when clicking interactive children
    const target = e.target as HTMLElement;
    if (target.closest(".app-no-drag")) return;
    e.preventDefault();
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().startDragging();
    });
  }

  if (!ankiReady) {
    return (
      <>
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
            <p className="text-sm text-foreground/50">{startupMsg}</p>
          </div>
        </div>
        <UpdatePrompt />
        <AboutDialog />
      </>
    );
  }

  return (
    <>
      <header
        onMouseDown={handleDrag}
        className="app-header sticky top-0 z-40 border-b border-foreground/10 bg-background"
      >
        <div className="app-row flex items-center justify-between gap-2 py-3">
          <div className="app-no-drag">
            <HeaderNav />
          </div>
          <div className="app-no-drag flex items-center gap-2">
            <UpdateBadge />
            <Link
              to="/settings"
              title="Settings"
              aria-label="Settings"
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <Gear size={16} weight="regular" />
            </Link>
          </div>
        </div>
      </header>
      <div className="app-row pt-5">
        <Breadcrumb />
      </div>
      <main className="app-row flex flex-1 flex-col py-6">
        <Outlet />
      </main>
      <CommandPalette />
      <UpdatePrompt />
      <AboutDialog />
    </>
  );
}
