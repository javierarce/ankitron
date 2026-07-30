// Per-deck preferences that are Ankitron's own, not Anki's.
//
// Anki has deck *configs*, but those are shared presets — changing one silently
// changes every deck using it (see the autoplay helpers in lib/audio.ts). These
// preferences are the opposite: they belong to exactly one deck, and Anki has no
// field for them, so they live here.
//
// Everything is one localStorage blob rather than a key per deck per setting:
// renaming a deck then only has to move a single entry, and reading a deck's
// preferences is one parse instead of a scan.

import type { DeckRename } from "./deck";

export interface DeckPrefs {
  /**
   * The note type new notes in this deck start on — one of CardForm's card-type
   * values. Stored loosely as a string: this module has no business knowing the
   * editor's union, and the form validates what it reads.
   */
  noteType?: string;
  /** ElevenLabs voice the TTS dialog preselects for notes in this deck. */
  ttsVoiceId?: string;
}

const STORAGE_KEY = "ankitron.deck-prefs";

type AllPrefs = Record<string, DeckPrefs>;

function readAll(): AllPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Anything but an object means the blob was corrupted or written by a
    // different version — start clean rather than throwing on every read.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AllPrefs;
  } catch {
    return {};
  }
}

function writeAll(prefs: AllPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort: a blocked or full localStorage just means the preference
    // doesn't stick, which degrades to the built-in default.
  }
}

/** This deck's preferences; an empty object when it has none. */
export function getDeckPrefs(deck: string): DeckPrefs {
  return readAll()[deck] ?? {};
}

/**
 * Set one preference for one deck. Passing undefined clears it, and a deck left
 * with no preferences drops out of storage entirely — so the blob doesn't
 * accumulate empty entries for every deck ever visited.
 */
export function setDeckPref<K extends keyof DeckPrefs>(
  deck: string,
  key: K,
  value: DeckPrefs[K] | undefined,
): void {
  const all = readAll();
  const next: DeckPrefs = { ...all[deck] };
  if (value === undefined) delete next[key];
  else next[key] = value;
  if (Object.keys(next).length === 0) delete all[deck];
  else all[deck] = next;
  writeAll(all);
}

/**
 * Carry preferences across a rename or move, given the plan renameDeck returns
 * (which covers the deck and every subdeck that moved with it). Call this
 * wherever deck renames land, next to recordDeckRedirect — a deck keyed by name
 * would otherwise silently lose its preferences the moment it's renamed.
 */
export function renameDeckPrefs(renames: DeckRename[]): void {
  const all = readAll();
  let changed = false;
  for (const { from, to } of renames) {
    if (from === to) continue;
    const prefs = all[from];
    if (!prefs) continue;
    delete all[from];
    all[to] = prefs;
    changed = true;
  }
  if (changed) writeAll(all);
}
