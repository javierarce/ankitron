// The toast copy for a failed mutation. A real AnkiConnect failure is thrown
// as an Error whose message is AnkiConnect's own explanation (anki-fetch.ts
// throws `new Error(data.error)`) — surface it. Anything else (the Tauri
// proxy rejects with a plain string like "AnkiConnect request failed: …" when
// Anki itself is unreachable) is technical noise, so fall back to fixed copy.
export function failureMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
