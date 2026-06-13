import { useEffect, useState } from "react";
import { useTheme, type Theme } from "@/lib/theme-context";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type CheckState = "idle" | "checking" | "uptodate" | "error";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<CheckState>("idle");
  const [checkError, setCheckError] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setVersion).catch(() => {})
    );
  }, []);

  async function checkForUpdates() {
    if (!isTauri || check === "checking") return;
    setCheck("checking");
    setCheckError("");
    try {
      const { check: checkUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await checkUpdate();
      if (found) {
        // Hand the update off to <UpdatePrompt>, which owns the
        // download/install/relaunch flow and its error handling.
        window.dispatchEvent(
          new CustomEvent("update-available", { detail: found })
        );
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

      <div className="divide-y divide-foreground/10">
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
            className="rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        {isTauri && (
          <div className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="text-sm font-medium">Updates</p>
              <p className="text-xs text-foreground/50">
                {version ? `AnkiTron ${version}` : "AnkiTron"}
                {check === "uptodate" && " — you're up to date"}
                {check === "error" && ` — ${checkError}`}
              </p>
            </div>
            <button
              onClick={checkForUpdates}
              disabled={check === "checking"}
              className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-60"
            >
              {check === "checking" ? "Checking…" : "Check for updates"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
