import { Note } from "./types";
import { CLOZE_TYPED_MODEL } from "./cloze-typed-model";

export interface ExportedNote {
  noteId?: number;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  /**
   * Deck path of the note's first card (e.g. "Spanish::Verbs"). Anki's
   * `deck:"X"` search pulls in subdeck cards too, so a single export can span a
   * whole subtree — this lets the import recreate that structure instead of
   * flattening everything into one deck. Optional for backward compatibility
   * with older exports that predate subdeck support.
   */
  deck?: string;
  /**
   * Per-card deck paths, indexed by card template ordinal. Only present when a
   * note's cards span more than one deck (e.g. "Basic (and reversed card)" with
   * the forward and reverse cards filed separately). For the common single-card
   * case this is omitted and `deck` alone describes the note.
   */
  cardDecks?: string[];
  /**
   * Note's last-modified time (epoch seconds) when it was exported. Used on a
   * same-deck re-import to avoid clobbering a note the user has edited in Anki
   * since the export was taken. Absent on older exports and when AnkiConnect
   * doesn't report it — in which case we fall back to overwriting.
   */
  mod?: number;
}

export interface ExportedDeck {
  deckName: string;
  exportedAt: string;
  notes: ExportedNote[];
}

export interface ImportResult {
  updated: number;
  added: number;
  skipped: number;
  errors: string[];
}

export interface ImportDeps {
  ankiFetch: <T>(action: string, params?: Record<string, unknown>) => Promise<T>;
  ensureClozeTypedModel: () => Promise<void>;
}

export interface ImportOptions {
  /**
   * When true, every note becomes an add regardless of whether its noteId
   * already exists in Anki. Use this for cross-deck imports — otherwise we'd
   * silently update cards in the *source* deck via their noteIds.
   */
  addOnly?: boolean;
}

export function flattenFields(fields: Note["fields"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    out[name] = field?.value ?? "";
  }
  return out;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (!cleaned || /^_+$/.test(cleaned)) return "deck";
  return cleaned;
}

export function buildExport(
  deckName: string,
  notes: Note[],
  now: Date = new Date(),
  cardDecksByNoteId?: Map<number, string[]>,
): ExportedDeck {
  return {
    deckName,
    exportedAt: now.toISOString(),
    notes: notes.map((note) => {
      const cardDecks = cardDecksByNoteId?.get(note.noteId);
      const deck = cardDecks?.[0];
      // Only carry the full per-card list when the cards actually live in
      // different decks; otherwise `deck` alone says everything.
      const spansMultiple = cardDecks
        ? new Set(cardDecks).size > 1
        : false;
      return {
        noteId: note.noteId,
        modelName: note.modelName,
        fields: flattenFields(note.fields),
        tags: note.tags,
        ...(deck ? { deck } : {}),
        ...(spansMultiple ? { cardDecks } : {}),
        ...(typeof note.mod === "number" ? { mod: note.mod } : {}),
      };
    }),
  };
}

interface CardDeckInfo {
  cardId: number;
  deckName: string;
}

/**
 * Resolve each note to the decks of its cards, indexed by card template ordinal.
 * Anki tracks decks on cards, not notes, and a single note can have cards filed
 * in different decks (e.g. "Basic (and reversed card)"). Notes with no card info
 * are omitted from the map (the export then carries no deck and the import falls
 * back to the root target).
 */
export async function fetchCardDecksByNoteId(
  notes: Note[],
  ankiFetch: <T>(action: string, params?: Record<string, unknown>) => Promise<T>,
): Promise<Map<number, string[]>> {
  const cardIds: number[] = [];
  for (const note of notes) {
    for (const card of note.cards ?? []) {
      if (typeof card === "number") cardIds.push(card);
    }
  }

  const deckByCard = new Map<number, string>();
  if (cardIds.length > 0) {
    const infos = await ankiFetch<CardDeckInfo[]>("cardsInfo", {
      cards: cardIds,
    });
    for (const info of infos) {
      if (info && typeof info.cardId === "number" && info.deckName) {
        deckByCard.set(info.cardId, info.deckName);
      }
    }
  }

  const out = new Map<number, string[]>();
  for (const note of notes) {
    const decks = (note.cards ?? [])
      .map((c) => deckByCard.get(c))
      .filter((d): d is string => Boolean(d));
    if (decks.length > 0) out.set(note.noteId, decks);
  }
  return out;
}

/**
 * Map a note's source deck onto the chosen import target, preserving subdeck
 * structure relative to the export's root. A note exported from
 * "Spanish::Verbs" imported into "Español" lands in "Español::Verbs".
 */
export function resolveTargetDeck(
  rootTarget: string,
  sourceRoot: string,
  noteDeck: string | undefined,
): string {
  if (!noteDeck || noteDeck === sourceRoot) return rootTarget;
  const prefix = `${sourceRoot}::`;
  if (noteDeck.startsWith(prefix)) {
    return `${rootTarget}::${noteDeck.slice(prefix.length)}`;
  }
  // Note's deck sits outside the exported subtree (shouldn't normally happen);
  // fall back to the root target rather than inventing an unrelated deck.
  return rootTarget;
}

/**
 * Resolve every card of a note to its import target deck, indexed by ordinal.
 * Falls back to the single `deck` (or root) when the export has no per-card
 * detail. The first entry is always the note's primary deck — where addNote
 * initially files all of its cards.
 */
export function resolveCardTargets(
  rootTarget: string,
  sourceRoot: string,
  note: ExportedNote,
): string[] {
  if (note.cardDecks && note.cardDecks.length > 0) {
    return note.cardDecks.map((d) =>
      resolveTargetDeck(rootTarget, sourceRoot, d),
    );
  }
  return [resolveTargetDeck(rootTarget, sourceRoot, note.deck)];
}

export function isExportedDeck(data: unknown): data is ExportedDeck {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.deckName !== "string") return false;
  if (!Array.isArray(d.notes)) return false;
  return d.notes.every((n) => {
    if (!n || typeof n !== "object") return false;
    const note = n as Record<string, unknown>;
    return (
      typeof note.modelName === "string" &&
      note.fields !== null &&
      typeof note.fields === "object" &&
      Array.isArray(note.tags)
    );
  });
}

/**
 * After a note is added (all its cards land in `primaryDeck`), file each sibling
 * card into the deck it was exported from. Only touches cards whose target
 * differs from the primary, and batches one changeDeck call per destination.
 * Best-effort: a card it can't move stays in the primary deck rather than
 * failing the whole import.
 */
async function placeCards(
  newNoteId: number,
  primaryDeck: string,
  cardTargets: string[],
  deps: ImportDeps,
) {
  if (!cardTargets.some((d) => d !== primaryDeck)) return;

  const info = await deps.ankiFetch<Array<{ cards?: number[] }>>("notesInfo", {
    notes: [newNoteId],
  });
  const cards = info[0]?.cards ?? [];
  if (cards.length === 0) return;

  const byDeck = new Map<string, number[]>();
  for (let i = 0; i < cards.length; i += 1) {
    const target = cardTargets[i] ?? primaryDeck;
    if (target === primaryDeck) continue;
    const group = byDeck.get(target) ?? [];
    group.push(cards[i]);
    byDeck.set(target, group);
  }

  for (const [deck, cardIds] of byDeck) {
    await deps.ankiFetch("changeDeck", { cards: cardIds, deck });
  }
}

async function importOne(
  cardTargets: string[],
  note: ExportedNote,
  existingIds: Set<number>,
  result: ImportResult,
  deps: ImportDeps,
) {
  const targetDeck = cardTargets[0];
  const tags = (note.tags ?? []).map((t) => String(t)).filter(Boolean);

  if (note.noteId && existingIds.has(note.noteId)) {
    try {
      const existing = await deps.ankiFetch<Note[]>("notesInfo", {
        notes: [note.noteId],
      });
      const existingNote = existing[0];
      const existingMod = existingNote?.mod;

      // Stale-import guard: if the live note has been edited since this export
      // was taken, leave it alone rather than overwriting the user's newer work.
      // Only applies when both timestamps are known; otherwise we overwrite.
      if (
        typeof note.mod === "number" &&
        typeof existingMod === "number" &&
        existingMod > note.mod
      ) {
        result.skipped += 1;
        return;
      }

      await deps.ankiFetch("updateNoteFields", {
        note: { id: note.noteId, fields: note.fields },
      });

      // Merge tags (union) instead of replacing them. A wholesale replace would
      // strip Anki-managed tags like `leech`/`marked` and anything the user
      // added since exporting — re-importing should never destroy those.
      const currentTags = existingNote?.tags ?? [];
      const newTags = tags.filter((t) => !currentTags.includes(t));
      if (newTags.length > 0) {
        await deps.ankiFetch("addTags", {
          notes: [note.noteId],
          tags: newTags.join(" "),
        });
      }
      result.updated += 1;
    } catch (err) {
      result.errors.push(
        `Update ${note.noteId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
    return;
  }

  try {
    if (note.modelName === CLOZE_TYPED_MODEL) {
      await deps.ensureClozeTypedModel();
    }
    const newId = await deps.ankiFetch<number | null>("addNote", {
      note: {
        deckName: targetDeck,
        modelName: note.modelName,
        fields: note.fields,
        tags,
        // Scope duplicate detection to the target deck only. Anki's default
        // is collection-wide, which would reject every card on a cross-deck
        // import as a duplicate of its source-deck copy.
        options: { duplicateScope: "deck" },
      },
    });
    if (newId) {
      result.added += 1;
      try {
        await placeCards(newId, targetDeck, cardTargets, deps);
      } catch (err) {
        result.errors.push(
          `Place cards for ${newId}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    } else {
      result.skipped += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    // Anki rejects notes whose first field collides with an existing note.
    // Treat that as a skip rather than an error: it almost always means the
    // card is already in the deck (re-import, or overlap with another deck).
    if (/duplicate/i.test(msg)) {
      result.skipped += 1;
      return;
    }
    result.errors.push(`Add note: ${msg}`);
  }
}

export async function importDeck(
  deckName: string,
  parsed: ExportedDeck,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const existingIds = new Set<number>();

  if (!options.addOnly) {
    const idsInFile = parsed.notes
      .map((n) => n.noteId)
      .filter((id): id is number => typeof id === "number");

    if (idsInFile.length > 0) {
      const info = await deps.ankiFetch<Array<Note | Record<string, never>>>(
        "notesInfo",
        { notes: idsInFile },
      );
      info.forEach((entry, i) => {
        if (entry && "noteId" in entry && entry.noteId) {
          existingIds.add(idsInFile[i]);
        }
      });
    }
  }

  // Resolve every note's per-card target decks up front so we can both
  // pre-create the subdecks and reuse them when importing.
  const cardTargetsByNote = parsed.notes.map((note) =>
    resolveCardTargets(deckName, parsed.deckName, note),
  );

  // Recreate any subdecks the export spanned before adding cards, so addNote and
  // changeDeck land them in the right place instead of flattening into the root.
  const subdecks = new Set<string>();
  for (const targets of cardTargetsByNote) {
    for (const target of targets) {
      if (target !== deckName) subdecks.add(target);
    }
  }
  for (const sub of subdecks) {
    try {
      await deps.ankiFetch("createDeck", { deck: sub });
    } catch {
      // Best-effort: a real failure will surface when the note is added.
    }
  }

  const result: ImportResult = { updated: 0, added: 0, skipped: 0, errors: [] };
  for (let i = 0; i < parsed.notes.length; i += 1) {
    await importOne(
      cardTargetsByNote[i],
      parsed.notes[i],
      existingIds,
      result,
      deps,
    );
  }
  return result;
}

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Save a deck export to disk. In the Tauri app this opens a native save dialog
 * so the user picks the destination folder and filename; in the browser it
 * falls back to a plain anchor download into the default Downloads folder.
 * Resolves to false if the user cancels the dialog, true otherwise.
 */
export async function downloadDeckJson(
  payload: ExportedDeck,
  name: string,
): Promise<boolean> {
  const json = JSON.stringify(payload, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const defaultName = `${sanitizeFilename(name)}-${date}.json`;

  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return false; // user cancelled
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_text_file", { path, contents: json });
    return true;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
