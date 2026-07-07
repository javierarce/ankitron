import { useState } from "react";
import { Spinner } from "@/components/spinner";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** AnkiConnect's add-on code on AnkiWeb — what the user pastes into Anki. */
const ANKICONNECT_CODE = "2055492159";
const ANKICONNECT_URL = `https://ankiweb.net/shared/info/${ANKICONNECT_CODE}`;
const ANKI_DOWNLOAD_URL = "https://apps.ankiweb.net";

/**
 * Why we can't reach Anki, as reported by the backend's `wait_for_anki`:
 *   "no-anki"     — the Anki app isn't installed.
 *   "no-addon"    — Anki is running but the AnkiConnect add-on is missing.
 *   "unreachable" — Anki was reachable but a request just failed (e.g. the user
 *                   quit Anki mid-session); the fallback for anything else.
 */
export type AnkiConnectionReason = "no-anki" | "no-addon" | "unreachable";

/**
 * Full-screen block shown when Ankitron can't talk to Anki. Ankitron drives
 * Anki through the AnkiConnect add-on, so "can't connect" almost always means
 * one of two very different things — Anki isn't installed, or the add-on isn't.
 * We surface the specific fix for each instead of a single vague message, since
 * otherwise a missing add-on reads as an infinite "Starting Anki…" spinner.
 */
export function AnkiConnectionError({
  reason = "unreachable",
}: {
  reason?: AnkiConnectionReason;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    // Anki may just have been closed, or the add-on was only now installed —
    // ask the backend to (re)launch Anki headless, then reload so startup
    // re-probes the connection from scratch.
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ensure_anki");
      } catch (err) {
        console.error("Could not start Anki:", err);
      }
    }
    window.location.reload();
  }

  // Full-screen overlay so the header (nav, sync) is covered and inert while
  // disconnected, and the message stays centered.
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8 text-red-500"
          aria-hidden="true"
        >
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
        </svg>
      </div>

      <ReasonBody reason={reason} />

      {/* The AnkiConnect flow ends with the user quitting Ankitron entirely, so
          a "Try again" here would do nothing useful — they reopen the app to
          reconnect. Every other reason is fixed with the app still open. */}
      {reason !== "no-addon" && (
        <button
          onClick={retry}
          disabled={retrying}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {retrying ? (
            <Spinner size="sm" tone="inverted" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v5h-5" />
            </svg>
          )}
          {retrying ? "Reconnecting…" : "Try again"}
        </button>
      )}
    </div>
  );
}

function ReasonBody({ reason }: { reason: AnkiConnectionReason }) {
  if (reason === "no-anki") {
    return (
      <>
        <h2 className="text-xl font-semibold">Anki isn&apos;t installed</h2>
        <p className="mt-2 max-w-sm text-sm text-foreground/60">
          Ankitron needs the free Anki desktop app to store and schedule your
          cards. Install it, then try again.
        </p>
        <a
          href={ANKI_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-4 text-sm font-medium text-foreground underline underline-offset-4 hover:opacity-80"
        >
          Download Anki
        </a>
      </>
    );
  }

  if (reason === "no-addon") {
    return (
      <>
        <h2 className="text-xl font-semibold">AnkiConnect isn&apos;t installed</h2>
        <p className="mt-2 max-w-md text-sm text-foreground/60">
          Ankitron connects to Anki through the free{" "}
          <a
            href={ANKICONNECT_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-4 hover:opacity-80"
          >
            AnkiConnect
          </a>{" "}
          add-on, which is not yet installed.
        </p>
        <p className="mt-4 max-w-md text-sm text-foreground/60">
          Please close Ankitron, install the add-on in Anki, and then reopen
          Ankitron.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-xl font-semibold">Anki isn&apos;t connected</h2>
      <p className="mt-2 max-w-sm text-sm text-foreground/60">
        Ankitron can&apos;t reach Anki right now. Make sure Anki is running,
        then try again.
      </p>
    </>
  );
}
