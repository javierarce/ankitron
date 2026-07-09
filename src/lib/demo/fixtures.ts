// Demo content, loaded from the deck files in ./decks.
//
// Each ./decks/*.json is a real Ankitron deck export — it passes isExportedDeck
// and could be dropped straight into the app to import. The only addition is a
// demo-only `state` on each note ("new" | "learn" | "review" | "done"), which
// the real importer ignores (it validates modelName/fields/tags only) but the
// demo uses to seed scheduling: which cards are due, in which bucket, and what
// the study queue contains. To change the demo's content, edit those JSON files
// — counts, study queues, search, and tags all derive from them here.

import { compareDeckPaths, isCardInDeck } from "@/lib/deck";
import { isExportedDeck } from "@/lib/import-export";
import demoConfig from "./demo-config.json";

export type DemoState = "new" | "learn" | "review" | "done";

export interface DemoNote {
  noteId: number;
  deckName: string;
  modelName: string;
  front: string;
  back: string;
  tags: string[];
  state: DemoState;
  suspended: boolean;
  /** Card flag, 0 (none) to 7, mirroring Anki's per-card flag. */
  flag: number;
}

// The deck-file note shape, plus our demo-only `state`. `deck` overrides the
// file's top-level deckName to place a note in a subdeck.
interface RawNote {
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  deck?: string;
  state?: DemoState;
}

const VALID_STATES: ReadonlySet<string> = new Set([
  "new",
  "learn",
  "review",
  "done",
]);

// Every "a::b::c" path implies its ancestors "a" and "a::b" exist as decks.
function ancestorPaths(path: string): string[] {
  const segs = path.split("::");
  return segs.map((_, i) => segs.slice(0, i + 1).join("::"));
}

// Eagerly load and validate every deck file at module init. A bad file throws
// here — in the demo build that surfaces immediately (a loud console error on
// load) rather than rendering a quietly-wrong page, and the fixtures test below
// catches it in CI.
const deckFiles = import.meta.glob<{ default: unknown }>("./decks/*.json", {
  eager: true,
});

let nextNoteId = 1;
const notes: DemoNote[] = [];
const deckNames = new Set<string>();

// Sort the file entries for a deterministic note order (import.meta.glob keys
// are path-sorted already, but be explicit).
for (const [file, mod] of Object.entries(deckFiles).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const deck = mod.default;
  if (!isExportedDeck(deck)) {
    throw new Error(
      `[demo] ${file} is not a valid Ankitron deck file ` +
        `(needs deckName + notes[] with modelName/fields/tags).`,
    );
  }

  deckNames.add(deck.deckName);
  for (const raw of deck.notes as RawNote[]) {
    if (raw.state && !VALID_STATES.has(raw.state)) {
      throw new Error(
        `[demo] ${file}: note "${raw.fields.Front ?? ""}" has invalid state ` +
          `"${raw.state}" (expected new | learn | review | done).`,
      );
    }
    const path = raw.deck || deck.deckName;
    for (const a of ancestorPaths(path)) deckNames.add(a);

    const values = Object.values(raw.fields);
    notes.push({
      noteId: nextNoteId++,
      deckName: path,
      modelName: raw.modelName,
      // Curated editors use Front/Back (Basic) or Text/Back Extra (Cloze);
      // fall back to field order for any other note type.
      front: raw.fields.Front ?? raw.fields.Text ?? values[0] ?? "",
      back: raw.fields.Back ?? raw.fields["Back Extra"] ?? values[1] ?? "",
      tags: raw.tags ?? [],
      state: raw.state ?? "new",
      suspended: false,
      flag: 0,
    });
  }
}

// Deck registry — seeded from the loaded notes, but growable at runtime so a
// deck created during the session (importing a deck, or adding a note to a
// brand-new deck) shows up just like it would in the real app. Ids are stable
// once assigned.
let nextDeckId = 1;
const deckIdByName = new Map<string, number>();

/** The live deck tree: authored decks, their derived parents, and any added
 * during the session, in the order their ids were assigned. */
export const DECKS: { name: string; id: number }[] = [];

/** Register a deck path (and its ancestors) if not already known. */
export function ensureDeck(path: string): void {
  if (!path) return;
  for (const name of ancestorPaths(path)) {
    if (deckIdByName.has(name)) continue;
    const id = nextDeckId++;
    deckIdByName.set(name, id);
    DECKS.push({ name, id });
  }
}

/** Remove a deck and its subdecks from the registry (used by deleteDecks, e.g.
 * the create/move/delete emulation behind a deck rename). */
export function removeDeckSubtree(name: string): void {
  for (let i = DECKS.length - 1; i >= 0; i--) {
    const { name: deck } = DECKS[i];
    if (isCardInDeck(deck, name)) {
      DECKS.splice(i, 1);
      deckIdByName.delete(deck);
    }
  }
}

// Seed the registry from the loaded decks, in tree order for stable ids.
for (const name of [...deckNames].sort(compareDeckPaths)) ensureDeck(name);

/** Mutable note store — the session's add/edit/delete handlers act on this. */
export const NOTES: DemoNote[] = notes;

/** Append a note created during the session (the add-note form or an import). */
export function addDemoNote(
  deckName: string,
  front: string,
  back: string,
  state: DemoState,
  tags: string[],
): DemoNote {
  ensureDeck(deckName);
  const n: DemoNote = {
    noteId: nextNoteId++,
    deckName,
    modelName: "Basic",
    front,
    back,
    tags,
    state,
    suspended: false,
    flag: 0,
  };
  notes.push(n);
  return n;
}

/** In-memory media folder (filename -> base64), like Anki's collection.media. */
export const DEMO_MEDIA = new Map<string, string>();

/** Global "studied today" footer numbers — the only non-per-deck tunables. */
export const DEMO_STATS = demoConfig as {
  studiedTodayCards: number;
  secondsPerCard: number;
};

// --- Session persistence ---------------------------------------------------
// The app reloads the page after some actions (dismissing the import result,
// for one) to refresh its view from Anki. Anki is memory-only here, so without
// this a reload would wipe everything the visitor just did — an import would
// "succeed" and then vanish. We snapshot the mutable model to sessionStorage
// and restore it on load, so changes survive reloads within a tab. A brand-new
// visit (fresh tab) still starts from the clean fixtures.
const STORAGE_KEY = "ankitron-demo-state-v1";

export function persistDemoState(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        notes,
        decks: DECKS,
        deckIds: [...deckIdByName],
        media: [...DEMO_MEDIA],
        nextNoteId,
        nextDeckId,
      }),
    );
  } catch {
    // Storage unavailable or over quota — the demo just won't survive reloads.
  }
}

// Restore a prior snapshot over the freshly-loaded fixtures, if one exists.
(function hydrateFromSession() {
  try {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    notes.length = 0;
    notes.push(...snap.notes);
    DECKS.length = 0;
    DECKS.push(...snap.decks);
    deckIdByName.clear();
    for (const [name, deckId] of snap.deckIds) deckIdByName.set(name, deckId);
    DEMO_MEDIA.clear();
    for (const [file, data] of snap.media) DEMO_MEDIA.set(file, data);
    nextNoteId = snap.nextNoteId;
    nextDeckId = snap.nextDeckId;
  } catch {
    // Corrupt/incompatible snapshot — ignore and use the fresh fixtures.
  }
})();
