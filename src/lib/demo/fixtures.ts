// Demo content, loaded from the deck files in ./decks.
//
// Each ./decks/*.json is a real Ankitron deck export — it passes isExportedDeck
// and could be dropped straight into the app to import. The only addition is a
// demo-only `state` on each note ("new" | "learn" | "review" | "done"), which
// the real importer ignores (it validates modelName/fields/tags only) but the
// demo uses to seed scheduling: which cards are due, in which bucket, and what
// the study queue contains. To change the demo's content, edit those JSON files
// — counts, study queues, search, and tags all derive from them here.

import { compareDeckPaths } from "@/lib/deck";
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
    });
  }
}

/** The full deck tree (every authored deck plus its derived parents), sorted. */
export const DECKS: { name: string; id: number }[] = [...deckNames]
  .sort(compareDeckPaths)
  .map((name, i) => ({ name, id: i + 1 }));

/** Mutable note store — the session's add/edit/delete handlers act on this. */
export const NOTES: DemoNote[] = notes;

/** Append a note created during the session (the add-note form). */
export function addDemoNote(
  deckName: string,
  front: string,
  back: string,
  state: DemoState,
  tags: string[],
): DemoNote {
  const n: DemoNote = {
    noteId: nextNoteId++,
    deckName,
    modelName: "Basic",
    front,
    back,
    tags,
    state,
    suspended: false,
  };
  notes.push(n);
  return n;
}

/** Global "studied today" footer numbers — the only non-per-deck tunables. */
export const DEMO_STATS = demoConfig as {
  studiedTodayCards: number;
  secondsPerCard: number;
};
