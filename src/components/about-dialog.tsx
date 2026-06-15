import { useEffect, useState } from "react";
import { useScrollLock } from "@/hooks/use-scroll-lock";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const WEBSITE = "https://javier.computer";

/**
 * In-app About panel, opened from the "About AnkiTron" menu item (the Rust
 * side replaces the native panel and emits "show-about" instead, so the
 * credits can include a clickable link).
 */
export function AboutDialog() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");

  useScrollLock(open);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) =>
      listen("show-about", () => setOpen(true)).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
    );
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setVersion).catch(() => {})
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function openWebsite(e: React.MouseEvent) {
    e.preventDefault();
    if (isTauri) {
      import("@tauri-apps/plugin-shell").then(({ open }) => open(WEBSITE));
    } else {
      window.open(WEBSITE, "_blank", "noopener");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-foreground/10 bg-background p-8 text-center shadow-lg">
        <img
          src="/apple-touch-icon.png"
          alt=""
          className="mx-auto mb-4 h-20 w-20 rounded-[1.25rem]"
        />
        <h3 className="text-lg font-semibold">AnkiTron</h3>
        {version && (
          <p className="mt-0.5 text-sm text-foreground/50">Version {version}</p>
        )}
        <p className="mt-4 text-sm text-foreground/70">
          Created by{" "}
          <a
            href={WEBSITE}
            onClick={openWebsite}
            className="underline decoration-foreground/30 underline-offset-2 hover:text-foreground"
          >
            Javier Arce
          </a>
          .
        </p>
        <p className="mt-4 text-xs text-foreground/50">
          AnkiTron is an unofficial third-party app and is not affiliated with
          the official Anki project or Ankitects Pty Ltd.
        </p>
        <p className="mt-3 text-xs text-foreground/50">
          Disclaimer: Use at your own risk. The developer is not responsible
          for any data loss or synchronization errors with your AnkiWeb
          account.
        </p>
      </div>
    </div>
  );
}
