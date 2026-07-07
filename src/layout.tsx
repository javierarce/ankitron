import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Gear } from "@phosphor-icons/react/dist/ssr/Gear";
import { AboutDialog } from "@/components/about-dialog";
import {
  AnkiConnectionError,
  type AnkiConnectionReason,
} from "@/components/anki-connection-error";
import { Breadcrumb } from "@/components/breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { FileDropZone } from "@/components/file-drop-zone";
import { FullScreenSpinner } from "@/components/full-screen-spinner";
import { HeaderNav } from "@/components/header-nav";
import { ShortcutsButton } from "@/components/shortcuts-dialog";
import { SyncProvider } from "@/components/sync-provider";
import { UpdateBadge } from "@/components/update-badge";
import { UpdatePrompt } from "@/components/update-prompt";
import { useDeckImport } from "@/hooks/use-deck-import";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Startup connection state. Outside Tauri (browser dev / demo build) there's no
// Anki to wait for, so we begin "connected"; under Tauri we start "pending" and
// let `wait_for_anki` resolve it to connected or a specific failure reason.
type AnkiStartup = "pending" | "connected" | AnkiConnectionReason;

export function Layout() {
  const [ankiStartup, setAnkiStartup] = useState<AnkiStartup>(
    isTauri ? "pending" : "connected",
  );
  // App-wide deck import: dropping a JSON file anywhere in the window (header
  // included) opens the import flow. The window listener below already stops the
  // browser from navigating to a dropped file; this turns the drop into an
  // import instead.
  const importer = useDeckImport();

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

    // Wait for Anki to be reachable before rendering pages (they fetch on
    // mount). The launch sync itself runs in the background via SyncProvider so
    // the app opens instantly instead of waiting on an AnkiWeb round-trip.
    // `wait_for_anki` reports *why* it failed ("no-anki" / "no-addon") so we can
    // show the right fix instead of letting the page spin, then error, generic.
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("wait_for_anki").then((status) => {
        setAnkiStartup(normalizeStartup(status));
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

  if (ankiStartup === "pending") {
    return (
      <>
        <FullScreenSpinner label="Starting Anki…" />
        <UpdatePrompt />
        <AboutDialog />
      </>
    );
  }

  if (ankiStartup !== "connected") {
    // Anki isn't installed, or the AnkiConnect add-on is missing. Block here
    // with the specific fix rather than mounting pages that would just spin.
    return (
      <>
        <AnkiConnectionError reason={ankiStartup} />
        <UpdatePrompt />
        <AboutDialog />
      </>
    );
  }

  return (
    <SyncProvider>
      <FileDropZone
        onFile={importer.beginImportFromFile}
        className="flex min-h-dvh flex-col"
      >
        <header
          onMouseDown={handleDrag}
          className="app-header sticky top-0 z-40 border-b border-border bg-background"
        >
          <div className="app-row flex items-center justify-between gap-2 py-3">
            <div className="app-no-drag">
              <HeaderNav />
            </div>
            <div className="app-no-drag flex items-center gap-2">
              <UpdateBadge />
              <ShortcutsButton />
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
        {importer.dialogs}
      </FileDropZone>
    </SyncProvider>
  );
}

/** Map `wait_for_anki`'s reason string onto our startup states, treating any
 *  unexpected value as a generic "unreachable" so a backend change can never
 *  wedge the app on the spinner. */
function normalizeStartup(status: string): AnkiStartup {
  switch (status) {
    case "connected":
    case "no-anki":
    case "no-addon":
      return status;
    default:
      return "unreachable";
  }
}
