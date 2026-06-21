// Renaming a deck deletes it under its old name in Anki, but a stale history
// entry (e.g. pressing cmd+left after a rename) can still point at that old
// path. We remember where each renamed deck went so the deck-detail page can
// forward to the new name instead of dead-ending on a deck that no longer
// exists. Kept in-memory: it only needs to outlive the navigation, not reloads.
const redirects = new Map<string, string>();

/** Record that a deck previously named `from` now lives at `to`. */
export function recordDeckRedirect(from: string, to: string): void {
  if (from !== to) redirects.set(from, to);
}

/**
 * Resolve where a (possibly stale) deck name now points, following chained
 * renames (A→B→C resolves A to C). Returns undefined if the name was never
 * renamed. A cycle guard caps the walk so a pathological loop can't hang.
 */
export function resolveDeckRedirect(name: string): string | undefined {
  let current = redirects.get(name);
  if (current === undefined) return undefined;
  const seen = new Set<string>([name]);
  while (!seen.has(current)) {
    seen.add(current);
    const next = redirects.get(current);
    if (next === undefined) break;
    current = next;
  }
  return current;
}
