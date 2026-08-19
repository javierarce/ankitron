const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * (Re)launch Anki headless if it isn't answering, and wait for AnkiConnect to
 * come up — the backend polls for up to 15s. Ankitron starts Anki for you, so
 * "Anki quit" is a state the app can fix itself rather than a dead end the user
 * has to sort out in the Finder; every surface that reports a lost connection
 * offers this.
 *
 * Resolves to whether Anki is reachable afterwards. Never throws: a failed
 * invoke is just another way of saying "no".
 */
export async function ensureAnkiRunning(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("ensure_anki");
  } catch (err) {
    console.error("Could not start Anki:", err);
    return false;
  }
}
