/**
 * Turning a sync failure into something a person can act on.
 *
 * A failed sync reaches us as raw text from one of three layers, none of them
 * written for a reader: Tauri's proxy ("AnkiConnect request failed: error
 * sending request for url (http://127.0.0.1:8765/)"), AnkiConnect's own
 * exceptions ("sync: auth not configured"), or Anki's sync backend. Showing any
 * of them verbatim tells the user nothing about what broke or what to do next —
 * so we classify the message and answer both questions ourselves, keeping the
 * raw text only for failures we don't recognise.
 */

export type SyncFailureKind =
  /** The AnkiConnect request never got a reply — Anki itself is gone. */
  | "anki-unreachable"
  /** Anki has no AnkiWeb account, or AnkiWeb rejected the one it has. */
  | "auth"
  /** AnkiWeb wants a one-way full sync, which the headless API won't choose. */
  | "full-sync"
  /** Anki reached out to AnkiWeb and the network let it down. */
  | "network"
  /** Anything we can't place. */
  | "unknown";

export interface SyncFailure {
  kind: SyncFailureKind;
  /** Short enough for the corner pill. */
  label: string;
  /** A sentence or two: what happened, and what fixes it. */
  message: string;
  /** The raw error text — kept only when we couldn't recognise it. */
  detail?: string;
}

/**
 * The request never reached AnkiConnect. The first two are Tauri's proxy
 * (src-tauri/src/main.rs), which prefixes every transport failure; the last two
 * are the same thing in browser dev, where the call goes through Vite's proxy
 * and fails as a plain fetch.
 */
const ANKI_UNREACHABLE =
  /AnkiConnect request failed|Failed to parse AnkiConnect response|Failed to fetch|NetworkError when attempting to fetch/i;

/** AnkiConnect's raw refusal, plus the copy anki-fetch already rewrites it to. */
const FULL_SYNC = /Sync status \d+ not one of|full sync is required/i;

/**
 * Deliberately broad: Anki's sign-in failures are worded a dozen ways across
 * versions, and landing one of them in "unknown" would show raw backend text
 * for the single most fixable failure there is. Only reached once the transport
 * and full-sync cases are ruled out, so the breadth costs little.
 */
// The status codes are word-bounded on purpose: unbounded, `403` matches
// inside any note or card id that happens to contain it (they're 13-digit
// epoch-ms numbers), which would classify an unrecognised failure as a sign-in
// problem AND drop the raw text the "unknown" branch keeps.
const AUTH = /auth|ankiweb id|password|login|sign ?in|\b40[13]\b/i;
/** Told apart because "no account yet" and "wrong password" read differently. */
const AUTH_MISSING = /not configured|no auth/i;

// Same word-bounding as AUTH, for the same reason.
const NETWORK =
  /network|timed? ?out|temporarily unavailable|connection (reset|refused|closed|aborted)|dns|offline|\b50[234]\b/i;

/**
 * Why a full sync stops here, in the user's terms. Lives with the other sync
 * copy rather than at the throw site so there's one wording to keep right;
 * `syncCollection` imports it to rewrite AnkiConnect's opaque refusal ("Sync
 * status 2 not one of [0, 1]") the moment it happens.
 */
export const FULL_SYNC_MESSAGE =
  "A full sync is required, which Ankitron can't do on its own. Quit Ankitron, " +
  "open Anki and sync there (choosing which side to keep), then reopen Ankitron.";

/**
 * Classify a rejected sync. Accepts anything — the Tauri proxy rejects with a
 * bare string rather than an Error, so `err instanceof Error` can't be assumed.
 */
export function describeSyncFailure(err: unknown): SyncFailure {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).trim();

  // Classify by layer, transport first: reqwest often folds its cause into the
  // text ("…error sending request… tcp connect error: Connection refused"), so
  // NETWORK below would otherwise claim a dead Anki and send the user off to
  // check a connection that's fine.
  if (ANKI_UNREACHABLE.test(raw)) {
    return {
      kind: "anki-unreachable",
      label: "Anki isn't running",
      // Not "open Anki": Ankitron runs Anki headless itself, and a second
      // instance opened by hand would just refuse to start against the same
      // collection. Reconnect is the whole fix, and the copy has to say so —
      // otherwise the user goes looking for an Anki they can't launch.
      message:
        "Ankitron can't reach Anki — it looks like Anki quit. Reconnect and " +
        "Ankitron will start it again in the background.",
    };
  }

  if (FULL_SYNC.test(raw)) {
    return {
      kind: "full-sync",
      label: "Full sync needed",
      message: FULL_SYNC_MESSAGE,
    };
  }

  if (AUTH.test(raw)) {
    // Signing in needs Anki's own window, which can't be opened alongside the
    // headless copy Ankitron is holding the collection with — so every route
    // through here starts by quitting Ankitron, exactly like the full sync.
    return {
      kind: "auth",
      label: "AnkiWeb sign-in needed",
      message: AUTH_MISSING.test(raw)
        ? "Anki has no AnkiWeb account set up, so there's nothing to sync " +
          "with. Quit Ankitron, open Anki and sign in under Preferences → " +
          "Syncing, then reopen Ankitron."
        : "AnkiWeb wouldn't accept Anki's sign-in. Quit Ankitron, open Anki " +
          "and sign in again under Preferences → Syncing, then reopen " +
          "Ankitron.",
    };
  }

  if (NETWORK.test(raw)) {
    return {
      kind: "network",
      label: "AnkiWeb unreachable",
      message:
        "Anki couldn't reach AnkiWeb. Check your internet connection, then " +
        "try again.",
    };
  }

  return {
    kind: "unknown",
    label: "Sync failed",
    message: "Anki couldn't finish the sync.",
    // Unrecognised, so the raw text is the only clue there is — show it, but
    // as a secondary line rather than as the explanation.
    detail: raw || undefined,
  };
}
