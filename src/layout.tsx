import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Breadcrumb } from "@/components/breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { HeaderNav } from "@/components/header-nav";
import { SyncButton } from "@/components/sync-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { UpdatePrompt } from "@/components/update-prompt";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function Layout() {
  const [ankiReady, setAnkiReady] = useState(!isTauri);

  useEffect(() => {
    if (!isTauri) return;

    document.documentElement.classList.add("tauri");
    import("@tauri-apps/plugin-os").then(({ platform }) => {
      if (platform() === "macos") {
        document.documentElement.classList.add("tauri-mac");
      }
    });

    // Wait for Anki to be ready before rendering pages
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("wait_for_anki").then((ok) => {
        setAnkiReady(true);
        if (!ok) {
          console.warn("Anki did not start in time");
        }
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
            <p className="text-sm text-foreground/50">Starting Anki&hellip;</p>
          </div>
        </div>
        <UpdatePrompt />
      </>
    );
  }

  return (
    <>
      <header
        onMouseDown={handleDrag}
        className="app-header border-b border-foreground/10"
      >
        <div className="app-row flex items-center justify-between gap-2 py-3">
          <div className="app-no-drag">
            <HeaderNav />
          </div>
          <div className="app-no-drag flex items-center gap-2">
            <SyncButton />
            <ThemeToggle />
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
    </>
  );
}
